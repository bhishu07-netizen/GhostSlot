// GhostSlot Demo Room — board 1 of 3: ESP32-S3 TRANSMITTER ("node-a")
//
// Job: fill the room with a steady stream of small Wi-Fi packets
// (ESP-NOW broadcast, 100 per second) so the receiver (node-b) can measure
// how the radio channel changes when people move. Every 5 s it also tells
// the GhostSlot server "node-a is alive" (a heartbeat, not a reading).
//
// Board: ESP32-S3 (Arduino IDE board "ESP32S3 Dev Module"), core 3.x.
// No wiring: just USB power.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include "secrets.h"
#include "ca_roots.h"

static const char *NODE_ID = "node-a";
static const uint32_t SEND_EVERY_MS = 10;        // 100 packets per second
static const uint32_t HEARTBEAT_EVERY_MS = 5000;

// Packet the receiver recognises. "GSLT" = GhostSlot.
struct __attribute__((packed)) GsPacket {
  char magic[4];
  uint32_t seq;
};

static const uint8_t BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
static uint32_t sentOk = 0, sentFail = 0;  // stats only
static bool espNowReady = false;

// ---------- Wi-Fi ----------------------------------------------------------
static void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("[wifi] connecting to \"%s\" ...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) { delay(300); Serial.print("."); }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] connected, IP %s, channel %d, signal %d dBm\n",
                  WiFi.localIP().toString().c_str(), WiFi.channel(), WiFi.RSSI());
  } else {
    Serial.println("[wifi] FAILED. Check WIFI_SSID / WIFI_PASS and that the hotspot is 2.4 GHz.");
  }
}

// ---------- ESP-NOW --------------------------------------------------------
static void onSent(const esp_now_send_info_t *, esp_now_send_status_t status) {
  if (status == ESP_NOW_SEND_SUCCESS) sentOk++; else sentFail++;
}

static void setupEspNow() {
  if (esp_now_init() != ESP_OK) { Serial.println("[esp-now] init failed"); return; }
  esp_now_register_send_cb(onSent);
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST, 6);
  peer.channel = 0;            // 0 = whatever channel the hotspot is on
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  if (esp_now_add_peer(&peer) != ESP_OK) { Serial.println("[esp-now] add peer failed"); return; }
  // Send as 802.11n (HT20, MCS0) so every packet carries the OFDM training
  // fields the receiver turns into CSI (the default 1 Mbps rate does not).
  esp_now_rate_config_t rate = {};
  rate.phymode = WIFI_PHY_MODE_HT20;
  rate.rate = WIFI_PHY_RATE_MCS0_LGI;
  if (esp_now_set_peer_rate_config(BROADCAST, &rate) != ESP_OK) Serial.println("[esp-now] rate config failed (CSI may be weaker)");
  espNowReady = true;
  Serial.println("[esp-now] broadcasting 100 packets/s");
}

// Runs on its own core so HTTPS calls never pause the packet stream.
static void senderTask(void *) {
  GsPacket pkt = {{'G', 'S', 'L', 'T'}, 0};
  TickType_t last = xTaskGetTickCount();
  for (;;) {
    if (espNowReady && WiFi.status() == WL_CONNECTED) {
      pkt.seq++;
      esp_now_send(BROADCAST, (const uint8_t *)&pkt, sizeof(pkt));
    }
    vTaskDelayUntil(&last, pdMS_TO_TICKS(SEND_EVERY_MS));
  }
}

// ---------- Heartbeat to the server ---------------------------------------
static void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClientSecure tls;
  tls.setCACert(GS_ROOT_CAS);
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/csi/demo-room";
  if (!http.begin(tls, url)) { Serial.println("[server] bad SERVER_URL"); return; }
  http.setTimeout(15000);  // Render's free tier can take ~30-50 s to wake up the first time
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_KEY);
  int code = http.POST(String("{\"nodeId\":\"") + NODE_ID + "\",\"heartbeat\":true}");
  if (code == 200)      Serial.println("[server] heartbeat OK (node-a online)");
  else if (code == 401) Serial.println("[server] 401: DEVICE_KEY does not match CSI_DEVICE_KEY on Render");
  else if (code == 503) Serial.println("[server] 503: CSI_DEVICE_KEY is not set on Render yet");
  else                  Serial.printf("[server] heartbeat failed: %d %s\n", code, http.errorToString(code).c_str());
  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\n=== GhostSlot node-a (transmitter) ===");
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);                 // no power-save gaps in the packet stream
  connectWifi();
  Serial.printf("[info] my MAC: %s\n", WiFi.macAddress().c_str());
  setupEspNow();
  xTaskCreatePinnedToCore(senderTask, "gs-send", 4096, nullptr, 2, nullptr, 1);
}

void loop() {
  static uint32_t lastBeat = 0, lastLog = 0;
  connectWifi();
  if (millis() - lastBeat >= HEARTBEAT_EVERY_MS || lastBeat == 0) {
    lastBeat = millis();
    sendHeartbeat();
  }
  if (millis() - lastLog >= 5000) {
    lastLog = millis();
    Serial.printf("[esp-now] packets sent ok=%lu failed=%lu\n", (unsigned long)sentOk, (unsigned long)sentFail);
  }
  delay(50);
}
