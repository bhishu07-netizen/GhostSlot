// GhostSlot Demo Room — board 3 of 3: ESP32-C3 SuperMini + 128x64 OLED
//
// Job: every 2 seconds, ask the GhostSlot server for the Demo Room's status
// and show it big on the OLED, so judges see the room react live.
//
// Wiring (4 jumpers, see the guide):
//   OLED VCC -> C3 3V3     OLED GND -> C3 GND
//   OLED SDA -> C3 GPIO8   OLED SCL -> C3 GPIO9
//
// Board: "ESP32C3 Dev Module", Tools > USB CDC On Boot: Enabled.
// Libraries: U8g2 (olikraus), ArduinoJson (bblanchon).

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <U8g2lib.h>
#include "secrets.h"
#include "ca_roots.h"

// ---- Your OLED's driver chip ----------------------------------------------
// 0.96" modules are almost always SSD1306. 1.3" modules are usually SH1106.
// If the screen shows garbage or a shifted picture, change 0 to 1.
#define OLED_IS_SH1106 0

static const int OLED_SDA = 8;
static const int OLED_SCL = 9;
static const uint32_t POLL_EVERY_MS = 2000;

#if OLED_IS_SH1106
U8G2_SH1106_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);
#else
U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);
#endif

struct RoomStatus {
  bool ok = false;
  int httpCode = 0;
  String state = "?";        // CALIBRATING / NORMAL / CHANGE_DETECTED / OFFLINE / UNKNOWN
  String mode = "?";         // hardware / simulation
  String calibration = "?";
  int samples = 0;
  int ageSec = -1;
  bool nodeA = false, nodeB = false;
  int baselineWindow = 15;
};

// ---------- Screen helpers -------------------------------------------------
static void drawCentered(const char *text, int y) {
  int w = oled.getStrWidth(text);
  oled.drawStr((128 - w) / 2, y, text);
}

static void showMessage(const char *line1, const char *line2, const char *line3 = "") {
  oled.clearBuffer();
  oled.setFont(u8g2_font_6x10_tf);
  drawCentered("GHOSTSLOT", 10);
  oled.drawHLine(0, 13, 128);
  oled.setFont(u8g2_font_helvB10_tr);
  drawCentered(line1, 32);
  oled.setFont(u8g2_font_6x10_tf);
  drawCentered(line2, 48);
  drawCentered(line3, 60);
  oled.sendBuffer();
}

static void showStatus(const RoomStatus &s) {
  oled.clearBuffer();
  // Top bar: name + data source.
  oled.setFont(u8g2_font_6x10_tf);
  oled.drawStr(0, 9, "DEMO ROOM");
  const char *src = s.mode == "hardware" ? "LIVE" : "SIM";
  oled.drawStr(128 - oled.getStrWidth(src), 9, src);
  oled.drawHLine(0, 12, 128);

  // Big word in the middle. CHANGE_DETECTED means the Wi-Fi channel moved,
  // not a head-count, so the screen says ACTIVITY, never "people".
  String big = s.state;
  if (s.state == "NORMAL") big = "QUIET";
  else if (s.state == "CHANGE_DETECTED") big = "ACTIVITY";
  else if (s.state == "CALIBRATING") big = "CALIBRATING";
  bool alert = s.state == "CHANGE_DETECTED";
  if (alert) { oled.drawBox(0, 15, 128, 26); oled.setDrawColor(0); }
  oled.setFont(big.length() > 8 ? u8g2_font_helvB12_tr : u8g2_font_helvB18_tr);
  drawCentered(big.c_str(), big.length() > 8 ? 34 : 37);
  oled.setDrawColor(1);

  // Detail lines.
  oled.setFont(u8g2_font_6x10_tf);
  char line[32];
  if (s.state == "CALIBRATING") {
    snprintf(line, sizeof line, "keep room empty %d/%d", s.samples > s.baselineWindow ? s.baselineWindow : s.samples, s.baselineWindow);
  } else if (s.ageSec >= 0) {
    snprintf(line, sizeof line, "updated %ds ago", s.ageSec);
  } else {
    snprintf(line, sizeof line, "no readings yet");
  }
  drawCentered(line, 52);
  snprintf(line, sizeof line, "TX:%s  RX:%s", s.nodeA ? "ok" : "--", s.nodeB ? "ok" : "--");
  drawCentered(line, 63);
  oled.sendBuffer();
}

// ---------- Network --------------------------------------------------------
static bool connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  showMessage("Wi-Fi...", WIFI_SSID);
  Serial.printf("[wifi] connecting to \"%s\" ...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  // Known C3 SuperMini quirk: its tiny antenna often fails to connect at
  // full power. 8.5 dBm fixes it and is plenty inside one room.
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) { delay(300); Serial.print("."); }
  Serial.println();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[wifi] FAILED");
    showMessage("NO WI-FI", "check hotspot +", "secrets.h");
    return false;
  }
  Serial.printf("[wifi] connected, IP %s\n", WiFi.localIP().toString().c_str());
  return true;
}

static RoomStatus fetchStatus() {
  RoomStatus s;
  WiFiClientSecure tls;
  tls.setCACert(GS_ROOT_CAS);
  HTTPClient http;
  if (!http.begin(tls, String(SERVER_URL) + "/api/csi/status?device=oled")) { s.httpCode = -100; return s; }
  http.setTimeout(15000);
  http.addHeader("X-Device-Key", DEVICE_KEY);
  s.httpCode = http.GET();
  if (s.httpCode == 200) {
    JsonDocument doc;
    if (!deserializeJson(doc, http.getString())) {
      s.ok = true;
      s.state = doc["state"] | "?";
      s.mode = doc["mode"] | "?";
      s.calibration = doc["calibrationStatus"] | "?";
      s.samples = doc["samplesCollected"] | 0;
      s.ageSec = doc["secondsSinceUpdate"].isNull() ? -1 : (int)(doc["secondsSinceUpdate"] | -1);
      s.nodeA = doc["devices"]["node-a"]["online"] | false;
      s.nodeB = doc["devices"]["node-b"]["online"] | false;
      s.baselineWindow = doc["config"]["baselineWindow"] | 15;
    }
  }
  http.end();
  return s;
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== GhostSlot OLED (ESP32-C3) ===");
  Wire.begin(OLED_SDA, OLED_SCL);
  oled.begin();
  oled.setBusClock(400000);
  showMessage("BOOTING", "GhostSlot", "Demo Room");
  WiFi.mode(WIFI_STA);
  connectWifi();
  showMessage("WAKING SERVER", "first call can", "take ~1 minute");
}

void loop() {
  static uint32_t lastPoll = 0;
  if (!connectWifi()) { delay(3000); return; }
  if (millis() - lastPoll >= POLL_EVERY_MS || lastPoll == 0) {
    lastPoll = millis();
    RoomStatus s = fetchStatus();
    if (s.ok) {
      Serial.printf("[status] %s mode=%s cal=%s samples=%d TX=%d RX=%d\n", s.state.c_str(), s.mode.c_str(),
                    s.calibration.c_str(), s.samples, s.nodeA, s.nodeB);
      showStatus(s);
    } else {
      Serial.printf("[status] request failed: %d %s\n", s.httpCode, HTTPClient::errorToString(s.httpCode).c_str());
      char code[24];
      snprintf(code, sizeof code, "error %d", s.httpCode);
      showMessage("SERVER?", code, "retrying...");
    }
  }
  delay(50);
}
