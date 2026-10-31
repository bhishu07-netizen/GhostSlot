/*
  GhostSlot IR door counter (any ESP32: classic, S3 or C3)
  ---------------------------------------------------------
  Two IR sensors across the door, about 15-20 cm apart, at waist height:
      beam A = corridor side (outside), beam B = room side (inside)

  Direction comes from the ORDER the beams are cut:
      A -> A+B -> B -> clear  = someone came IN   (+1)
      B -> A+B -> A -> clear  = someone went OUT  (-1)
      anything else (half a step in and back, a hand waved) = ignored
      a beam blocked for more than 4 s (someone standing in the door) = reset

  Each IN/OUT is posted to  SERVER_URL/api/door/event  and a heartbeat with
  the live beam states goes to  /api/door/heartbeat  every second, both with
  the same X-Device-Key as the Wi-Fi mesh boards. No personal data: counts only.

  Board settings (Arduino IDE): your board ("ESP32 Dev Module", "ESP32S3 Dev
  Module" or "ESP32C3 Dev Module", USB CDC On Boot: Enabled for S3/C3).
  Copy secrets.example.h to secrets.h and fill it in (same as the mesh boards).
*/
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "secrets.h"
#include "ca_roots.h"

// ---------------- wiring ----------------
#define PIN_BEAM_A 4    // outside sensor signal
#define PIN_BEAM_B 5    // inside sensor signal
// What the signal pin reads when the beam is CUT (someone in the way):
//   IR break-beam receiver (e.g. Adafruit 3 mm/5 mm pair) -> HIGH
//   IR obstacle module (FC-51, TCRT5000 board, E18-D80NK) -> LOW
#define CUT_LEVEL HIGH

// ---------------- timing ----------------
#define SAMPLE_MS      5      // read both sensors every 5 ms
#define DEBOUNCE_MS    30     // a change must hold this long to count
#define STUCK_MS       4000   // beam blocked longer than this = someone standing in the door
#define HEARTBEAT_MS   1000

// ---------------- shared state ----------------
static volatile bool beamA = false, beamB = false;   // debounced, true = cut
static QueueHandle_t events;                         // 'I' / 'O'
static volatile long entries = 0, exits = 0;
static uint32_t bootTag = 0;

// ---------- sensing task: debounce + direction state machine ----------
static void senseTask(void *) {
  bool rawA = false, rawB = false, stA = false, stB = false;
  uint32_t changedA = 0, changedB = 0;
  uint8_t seq[8]; uint8_t n = 0;           // sequence of states while someone is in the doorway
  uint8_t last = 0; uint32_t since = millis();
  TickType_t wake = xTaskGetTickCount();
  for (;;) {
    uint32_t now = millis();
    bool a = digitalRead(PIN_BEAM_A) == CUT_LEVEL;
    bool b = digitalRead(PIN_BEAM_B) == CUT_LEVEL;
    if (a != rawA) { rawA = a; changedA = now; }
    if (b != rawB) { rawB = b; changedB = now; }
    if (rawA != stA && now - changedA >= DEBOUNCE_MS) stA = rawA;
    if (rawB != stB && now - changedB >= DEBOUNCE_MS) stB = rawB;
    beamA = stA; beamB = stB;

    uint8_t code = (stA ? 1 : 0) | (stB ? 2 : 0);   // 0 clear, 1 A, 2 B, 3 A+B
    if (code != last) {
      if (code == 0) {
        // doorway clear again: decide what happened
        bool hasBoth = false;
        for (uint8_t i = 0; i < n; i++) if (seq[i] == 3) hasBoth = true;
        if (n >= 3 && seq[0] == 1 && seq[n - 1] == 2 && hasBoth) {
          entries++; char e = 'I'; xQueueSend(events, &e, 0);
          Serial.printf("[door] A -> A+B -> B  =>  IN   (inside %ld)\n", entries - exits);
        } else if (n >= 3 && seq[0] == 2 && seq[n - 1] == 1 && hasBoth) {
          exits++; char e = 'O'; xQueueSend(events, &e, 0);
          Serial.printf("[door] B -> A+B -> A  =>  OUT  (inside %ld)\n", entries - exits);
        } else if (n) {
          Serial.println("[door] didn't cross fully  =>  ignored");
        }
        n = 0;
      } else if (n == 0 || seq[n - 1] != code) {
        if (n < sizeof(seq)) seq[n++] = code;
      }
      last = code; since = now;
    } else if (code != 0 && now - since > STUCK_MS) {
      Serial.println("[door] beam blocked > 4 s (someone standing in the door)  =>  reset");
      n = 0; since = now;
    }
    vTaskDelayUntil(&wake, pdMS_TO_TICKS(SAMPLE_MS));
  }
}

// ---------- server ----------
static WiFiClientSecure tls;
static HTTPClient http;
static bool httpOpen = false;
static String openPath;

static void closeHttp() { http.end(); tls.stop(); httpOpen = false; }
static int postJson(const char *path, const String &body) {
  for (int attempt = 0; attempt < 2; attempt++) {
    if (!httpOpen || openPath != path) {
      if (httpOpen) closeHttp();
      tls.setCACert(GS_ROOT_CAS);
      http.setReuse(true);
      http.setTimeout(8000);
      httpOpen = http.begin(tls, String(SERVER_URL) + path);
      openPath = path;
      if (!httpOpen) return -100;
    }
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Key", DEVICE_KEY);
    int code = http.POST(body);
    if (code > 0) { http.getString(); return code; }
    closeHttp();
  }
  return -1;
}

static void connectWifi() {
  WiFi.mode(WIFI_STA);
#if CONFIG_IDF_TARGET_ESP32C3
  WiFi.setTxPower(WIFI_POWER_8_5dBm);  // C3 boards are unstable at full power
#endif
  Serial.printf("[wifi] connecting to \"%s\" ...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) { delay(300); Serial.print("."); }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) Serial.printf("[wifi] connected, IP %s\n", WiFi.localIP().toString().c_str());
  else Serial.println("[wifi] FAILED. Check WIFI_SSID / WIFI_PASS and that the hotspot is 2.4 GHz.");
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== GhostSlot IR door counter ===");
  pinMode(PIN_BEAM_A, INPUT_PULLUP);
  pinMode(PIN_BEAM_B, INPUT_PULLUP);
  bootTag = esp_random();
  events = xQueueCreate(32, sizeof(char));
  xTaskCreate(senseTask, "sense", 4096, nullptr, 3, nullptr);
  connectWifi();
  Serial.println("[door] walk through from the corridor side: you should see IN");
}

void loop() {
  static uint32_t lastBeat = 0, seqNo = 0;
  static char pending = 0; static uint32_t pendingId = 0;
  if (WiFi.status() != WL_CONNECTED) { closeHttp(); connectWifi(); return; }

  // send counted events (retry the same id until the server confirms)
  if (!pending && xQueueReceive(events, &pending, 0) == pdTRUE) pendingId = ++seqNo;
  if (pending) {
    String body = String("{\"event\":\"") + (pending == 'I' ? "in" : "out") + "\",\"id\":\"" + String(bootTag, HEX) + "-" + pendingId + "\"}";
    int code = postJson("/api/door/event", body);
    if (code == 200) { Serial.printf("[server] %s sent\n", pending == 'I' ? "IN" : "OUT"); pending = 0; }
    else if (code == 401) Serial.println("[server] 401: DEVICE_KEY does not match CSI_DEVICE_KEY on Render.");
    else { Serial.printf("[server] post failed: %d, retrying\n", code); delay(500); }
    return;
  }
  if (millis() - lastBeat >= HEARTBEAT_MS) {
    lastBeat = millis();
    String body = String("{\"a\":") + (beamA ? "true" : "false") + ",\"b\":" + (beamB ? "true" : "false") + "}";
    int code = postJson("/api/door/heartbeat", body);
    if (code != 200) Serial.printf("[server] heartbeat failed: %d\n", code);
  }
  delay(10);
}
