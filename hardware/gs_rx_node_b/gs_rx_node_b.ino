// GhostSlot Demo Room — board 2 of 3: ESP32-S3 RECEIVER ("node-b")
//
// Job: listen to node-a's packets, read the Wi-Fi Channel State Information
// (CSI) of each one, and turn it into ONE number every 2 seconds:
//   "how much did the channel change between packets?"
// An empty, still room gives a low, steady number; people moving between
// the boards make it jump. That number is posted to the GhostSlot server,
// which smooths it, calibrates a baseline and decides NORMAL / CHANGE_DETECTED.
//
// Board: ESP32-S3 (Arduino IDE board "ESP32S3 Dev Module"), core 3.x.
// No wiring: just USB power.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include "secrets.h"
#include "ca_roots.h"

static const char *NODE_ID = "node-b";
static const uint32_t REPORT_EVERY_MS = 2000;   // matches CSI_SAMPLE_RATE_MS on the server
static const uint32_t MIN_FRAMES = 20;          // fewer than this in 2 s = node-a not heard
static const float FEATURE_SCALE = 100.0f;      // server accepts 0..10000

// LLTF = first 64 subcarriers (128 bytes, imaginary then real). Skip the DC
// and guard subcarriers (positions 0 and 27..37), keep the 52 data ones.
static const int SC_COUNT = 64;

static portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
static uint8_t txMac[6] = {0};
static volatile bool txKnown = false;
static float prevAmp[SC_COUNT];
static bool havePrev = false;
// Accumulators for the current 2 s window (written in the Wi-Fi task).
static double winSum = 0;
static uint32_t winFrames = 0;
static uint32_t espNowPackets = 0;  // stats only

static inline bool usable(int k) { return k != 0 && (k < 27 || k > 37); }

// ---------- ESP-NOW: learn who node-a is ----------------------------------
static void onRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  if (len >= 4 && memcmp(data, "GSLT", 4) == 0) {
    espNowPackets++;
    if (!txKnown) {
      portENTER_CRITICAL(&mux);
      memcpy(txMac, info->src_addr, 6);
      txKnown = true;
      portEXIT_CRITICAL(&mux);
    }
  }
}

// ---------- CSI callback (runs in the Wi-Fi task: keep it short) ----------
static void onCsi(void *, wifi_csi_info_t *info) {
  if (!txKnown || !info || !info->buf || info->len < 2 * SC_COUNT) return;
  if (memcmp(info->mac, txMac, 6) != 0) return;          // only node-a's packets
  const int8_t *b = info->buf;
  float amp[SC_COUNT];
  int start = info->first_word_invalid ? 2 : 0;           // first 4 bytes = 2 subcarriers
  for (int k = 0; k < SC_COUNT; k++) {
    if (k < start) { amp[k] = 0; continue; }
    float im = b[2 * k], re = b[2 * k + 1];
    amp[k] = sqrtf(im * im + re * re);
  }
  if (havePrev) {
    float diff = 0; int n = 0;
    for (int k = start; k < SC_COUNT; k++) {
      if (!usable(k)) continue;
      diff += fabsf(amp[k] - prevAmp[k]);
      n++;
    }
    if (n > 0) {
      portENTER_CRITICAL(&mux);
      winSum += diff / n;
      winFrames++;
      portEXIT_CRITICAL(&mux);
    }
  }
  memcpy(prevAmp, amp, sizeof(amp));
  havePrev = true;
}

// ---------- Wi-Fi ----------------------------------------------------------
static void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("[wifi] connecting to \"%s\" ...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) { delay(300); Serial.print("."); }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED)
    Serial.printf("[wifi] connected, IP %s, channel %d, signal %d dBm\n",
                  WiFi.localIP().toString().c_str(), WiFi.channel(), WiFi.RSSI());
  else
    Serial.println("[wifi] FAILED. Check WIFI_SSID / WIFI_PASS and that the hotspot is 2.4 GHz.");
}

static void setupCsi() {
  esp_now_init();
  esp_now_register_recv_cb(onRecv);

  // Hear every frame on the channel, not only those addressed to us.
  wifi_promiscuous_filter_t filt = {};
  filt.filter_mask = WIFI_PROMIS_FILTER_MASK_MGMT | WIFI_PROMIS_FILTER_MASK_DATA;
  esp_wifi_set_promiscuous_filter(&filt);
  esp_wifi_set_promiscuous(true);

  wifi_csi_config_t cfg = {};
  cfg.lltf_en = true;
  cfg.htltf_en = true;
  cfg.stbc_htltf2_en = true;
  cfg.ltf_merge_en = true;
  cfg.channel_filter_en = false;   // keep subcarriers independent
  cfg.manu_scale = false;
  cfg.shift = 0;
  esp_err_t e1 = esp_wifi_set_csi_config(&cfg);
  esp_err_t e2 = esp_wifi_set_csi_rx_cb(onCsi, nullptr);
  esp_err_t e3 = esp_wifi_set_csi(true);
  if (e1 || e2 || e3) Serial.printf("[csi] setup error %d/%d/%d\n", e1, e2, e3);
  else Serial.println("[csi] listening for node-a ...");
}

// ---------- Talk to the server --------------------------------------------
static int postJson(const String &body, String &response) {
  WiFiClientSecure tls;
  tls.setCACert(GS_ROOT_CAS);
  HTTPClient http;
  if (!http.begin(tls, String(SERVER_URL) + "/api/csi/demo-room")) return -100;
  http.setTimeout(15000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_KEY);
  int code = http.POST(body);
  if (code > 0) response = http.getString();
  http.end();
  return code;
}

static void report(float feature, uint32_t frames) {
  String body, resp;
  bool heard = frames >= MIN_FRAMES;
  if (heard) body = String("{\"nodeId\":\"node-b\",\"value\":") + String(feature, 2) + "}";
  else       body = "{\"nodeId\":\"node-b\",\"heartbeat\":true}";

  int code = postJson(body, resp);
  if (!heard) {
    Serial.printf("[csi] only %lu frames from node-a in 2 s (espnow pkts=%lu). Is node-a on and on the same hotspot?\n",
                  (unsigned long)frames, (unsigned long)espNowPackets);
  }
  if (code == 200) {
    JsonDocument doc;
    const char *state = "?", *cal = "?";
    if (!deserializeJson(doc, resp)) {
      state = doc["status"]["state"] | "?";
      cal = doc["status"]["calibrationStatus"] | "?";
    }
    if (heard) Serial.printf("[csi] frames=%lu feature=%.2f -> server: %s (calibration %s)\n",
                             (unsigned long)frames, feature, state, cal);
  } else if (code == 409) {
    Serial.println("[server] 409: server is in SIMULATION mode. Switch it to hardware (guide, part 3).");
  } else if (code == 401) {
    Serial.println("[server] 401: DEVICE_KEY does not match CSI_DEVICE_KEY on Render.");
  } else if (code == 503) {
    Serial.println("[server] 503: CSI_DEVICE_KEY is not set on Render yet.");
  } else {
    Serial.printf("[server] post failed: %d %s\n", code, HTTPClient::errorToString(code).c_str());
  }
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\n=== GhostSlot node-b (receiver) ===");
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  connectWifi();
  Serial.printf("[info] my MAC: %s\n", WiFi.macAddress().c_str());
  setupCsi();
}

void loop() {
  static uint32_t lastReport = millis();
  static bool announced = false;
  connectWifi();
  if (txKnown && !announced) {
    announced = true;
    Serial.printf("[csi] found node-a at %02X:%02X:%02X:%02X:%02X:%02X\n",
                  txMac[0], txMac[1], txMac[2], txMac[3], txMac[4], txMac[5]);
  }
  if (millis() - lastReport >= REPORT_EVERY_MS) {
    lastReport = millis();
    portENTER_CRITICAL(&mux);
    double sum = winSum; uint32_t frames = winFrames;
    winSum = 0; winFrames = 0;
    portEXIT_CRITICAL(&mux);
    float feature = frames ? (float)(sum / frames) * FEATURE_SCALE : 0;
    if (feature > 10000) feature = 10000;
    if (WiFi.status() == WL_CONNECTED) report(feature, frames);
  }
  delay(20);
}
