// GhostSlot Demo Room — MESH node (flash the same sketch on every sensing board)
//
// Every board does two jobs at once:
//   1. Sends ~50 small ESP-NOW "pings" a second (802.11n frames, so every
//      ping carries the OFDM training fields that CSI is measured from).
//   2. Listens to the other boards' pings and measures, PER LINK
//      (e.g. "mesh-2 -> me"), over a 2-second window:
//        motion  = how much the signal changes from ping to ping
//                  (people moving between boards make this jump)
//        profile = the average signal strength in 8 slices of the channel
//                  (a person standing still still shadows the link, which
//                  shows up as a change in this shape vs. the empty room)
//        rssi    = average received signal strength
//   Every 2 s it posts all its links to the server over the phone hotspot:
//     POST /api/csi/mesh   X-Device-Key: <CSI_DEVICE_KEY>
//     { "nodeId":"mesh-1", "links":[ {"from":"mesh-2","frames":95,
//       "motion":12.3,"rssi":-48,"profile":[..8 numbers..]}, ... ] }
//   The server turns all links together into an occupancy level and a zone.
//
// Boards: ESP32-S3 ("ESP32S3 Dev Module"), ESP32 ("ESP32 Dev Module"),
//         ESP32-C3 ("ESP32C3 Dev Module", USB CDC On Boot: Enabled).
// Arduino core: esp32 by Espressif 3.x. Library: ArduinoJson.
// No wiring: just USB power (a power bank or phone charger is fine).

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include "secrets.h"
#include "ca_roots.h"

// ======== CHANGE THIS FOR EACH BOARD: 1, 2, 3 or 4 ========
#define NODE_NUM 1
// ==========================================================

static const uint32_t PING_EVERY_MS   = 20;    // ~50 pings per second
static const uint32_t REPORT_EVERY_MS = 2000;  // matches the server window
static const uint32_t MIN_FRAMES      = 15;    // fewer = link not heard this window
static const int      MAX_SRC         = 6;     // other boards we can track
static const int      SC_COUNT        = 64;    // L-LTF subcarriers
static const int      GROUPS          = 8;     // profile slices

static char NODE_ID[12];

// Ping packet. "GSMN" = GhostSlot mesh.
struct __attribute__((packed)) MeshPing {
  char     magic[4];
  uint8_t  num;
  uint32_t seq;
};
static const uint8_t BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

// Skip DC (0) and the guard band (27..37); keep the 52 data subcarriers.
static inline bool usable(int k) { return k != 0 && (k < 27 || k > 37); }
// Which of the 8 profile slices a usable subcarrier belongs to.
static int groupOf[SC_COUNT];

// Per-source accumulators for the current window (written in the Wi-Fi task).
struct Source {
  bool     used;
  uint8_t  mac[6];
  uint8_t  num;
  float    prevAmp[SC_COUNT];
  bool     havePrev;
  double   motionSum;
  uint32_t motionFrames;
  uint32_t frames;
  double   rssiSum;
  double   groupSum[GROUPS];
};
static Source src[MAX_SRC];
static portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
static volatile bool espNowReady = false;

// ---------- ESP-NOW: learn which MAC is which board -----------------------
static void onRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  if (len != (int)sizeof(MeshPing) || memcmp(data, "GSMN", 4) != 0) return;
  uint8_t num = ((const MeshPing *)data)->num;
  if (num == 0 || num == NODE_NUM || num > 9) return;
  portENTER_CRITICAL(&mux);
  int freeSlot = -1;
  for (int i = 0; i < MAX_SRC; i++) {
    if (src[i].used && memcmp(src[i].mac, info->src_addr, 6) == 0) {
      src[i].num = num;
      portEXIT_CRITICAL(&mux);
      return;
    }
    if (!src[i].used && freeSlot < 0) freeSlot = i;
  }
  if (freeSlot >= 0) {
    memset(&src[freeSlot], 0, sizeof(Source));
    memcpy(src[freeSlot].mac, info->src_addr, 6);
    src[freeSlot].num = num;
    src[freeSlot].used = true;
  }
  portEXIT_CRITICAL(&mux);
}

// ---------- CSI callback (Wi-Fi task: keep it short, no printing) ---------
static void onCsi(void *, wifi_csi_info_t *info) {
  if (!info || !info->buf || info->len < 2 * SC_COUNT) return;

  // Compute amplitudes first, outside the lock.
  const int8_t *b = info->buf;
  int start = info->first_word_invalid ? 2 : 0;   // first 4 bytes may be junk
  float amp[SC_COUNT];
  for (int k = 0; k < SC_COUNT; k++) {
    if (k < start) { amp[k] = 0; continue; }
    float im = b[2 * k], re = b[2 * k + 1];
    amp[k] = sqrtf(im * im + re * re);
  }

  portENTER_CRITICAL(&mux);
  for (int i = 0; i < MAX_SRC; i++) {
    Source &s = src[i];
    if (!s.used || memcmp(s.mac, info->mac, 6) != 0) continue;

    if (s.havePrev) {
      float diff = 0; int n = 0;
      for (int k = start; k < SC_COUNT; k++) {
        if (!usable(k)) continue;
        diff += fabsf(amp[k] - s.prevAmp[k]);
        n++;
      }
      if (n > 0) { s.motionSum += diff / n; s.motionFrames++; }
    }
    float gSum[GROUPS] = {0}; int gN[GROUPS] = {0};
    for (int k = start; k < SC_COUNT; k++) {
      if (!usable(k)) continue;
      gSum[groupOf[k]] += amp[k];
      gN[groupOf[k]]++;
    }
    for (int g = 0; g < GROUPS; g++) s.groupSum[g] += gN[g] ? gSum[g] / gN[g] : 0;
    memcpy(s.prevAmp, amp, sizeof(amp));
    s.havePrev = true;
    s.frames++;
    s.rssiSum += info->rx_ctrl.rssi;
    break;
  }
  portEXIT_CRITICAL(&mux);
}

// ---------- Wi-Fi + ESP-NOW + CSI setup ------------------------------------
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

static void setupMesh() {
  if (esp_now_init() != ESP_OK) { Serial.println("[esp-now] init failed"); return; }
  esp_now_register_recv_cb(onRecv);

  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST, 6);
  peer.channel = 0;            // 0 = whatever channel the hotspot is on
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  if (esp_now_add_peer(&peer) != ESP_OK) { Serial.println("[esp-now] add peer failed"); return; }

  esp_now_rate_config_t rate = {};
  rate.phymode = WIFI_PHY_MODE_HT20;
  rate.rate = WIFI_PHY_RATE_MCS0_LGI;
  if (esp_now_set_peer_rate_config(BROADCAST, &rate) != ESP_OK)
    Serial.println("[esp-now] rate config failed (CSI may be weaker)");

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
  else Serial.println("[csi] listening for the other mesh boards ...");
  espNowReady = true;
}

// Pings run in their own task so a slow HTTPS post never pauses them.
static void pingTask(void *) {
  MeshPing p = {{'G', 'S', 'M', 'N'}, (uint8_t)NODE_NUM, 0};
  TickType_t last = xTaskGetTickCount();
  for (;;) {
    if (espNowReady && WiFi.status() == WL_CONNECTED) {
      p.seq++;
      esp_now_send(BROADCAST, (const uint8_t *)&p, sizeof(p));
    }
    vTaskDelayUntil(&last, pdMS_TO_TICKS(PING_EVERY_MS));
  }
}

// ---------- Talk to the server (one TLS connection, kept alive) ------------
static WiFiClientSecure tls;
static HTTPClient http;
static bool httpOpen = false;

static bool openHttp() {
  tls.setCACert(GS_ROOT_CAS);
  http.setReuse(true);
  http.setTimeout(8000);
  httpOpen = http.begin(tls, String(SERVER_URL) + "/api/csi/mesh");
  return httpOpen;
}
static void closeHttp() { http.end(); tls.stop(); httpOpen = false; }

static int postJson(const String &body) {
  for (int attempt = 0; attempt < 2; attempt++) {
    if (!httpOpen && !openHttp()) return -100;
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Key", DEVICE_KEY);
    int code = http.POST(body);
    if (code > 0) { http.getString(); return code; }
    closeHttp();                       // connection dropped: reopen once
  }
  return -1;
}

static void report() {
  // Snapshot and reset every source's window under the lock.
  struct Snap { uint8_t num; uint32_t frames, motionFrames; double motionSum, rssiSum, groupSum[GROUPS]; };
  Snap snaps[MAX_SRC]; int nSnap = 0;
  portENTER_CRITICAL(&mux);
  for (int i = 0; i < MAX_SRC; i++) {
    Source &s = src[i];
    if (!s.used) continue;
    Snap &x = snaps[nSnap++];
    x.num = s.num; x.frames = s.frames; x.motionFrames = s.motionFrames;
    x.motionSum = s.motionSum; x.rssiSum = s.rssiSum;
    memcpy(x.groupSum, s.groupSum, sizeof(x.groupSum));
    s.frames = 0; s.motionFrames = 0; s.motionSum = 0; s.rssiSum = 0;
    memset(s.groupSum, 0, sizeof(s.groupSum));
  }
  portEXIT_CRITICAL(&mux);

  JsonDocument doc;
  doc["nodeId"] = NODE_ID;
  JsonArray links = doc["links"].to<JsonArray>();
  for (int i = 0; i < nSnap; i++) {
    Snap &x = snaps[i];
    if (x.frames < MIN_FRAMES || x.motionFrames == 0) {
      Serial.printf("[csi] weak link from mesh-%d: %lu frames in 2 s\n", x.num, (unsigned long)x.frames);
      continue;
    }
    JsonObject l = links.add<JsonObject>();
    char from[12]; snprintf(from, sizeof(from), "mesh-%d", x.num);
    l["from"] = from;
    l["frames"] = x.frames;
    l["motion"] = serialized(String(x.motionSum / x.motionFrames * 100.0, 2));
    l["rssi"] = serialized(String(x.rssiSum / x.frames, 1));
    JsonArray prof = l["profile"].to<JsonArray>();
    for (int g = 0; g < GROUPS; g++) prof.add(serialized(String(x.groupSum[g] / x.frames, 2)));
  }

  String body; serializeJson(doc, body);
  int code = postJson(body);
  if (code == 200) {
    Serial.printf("[mesh] sent %d link(s) -> server ok\n", (int)links.size());
  } else if (code == 409) {
    Serial.println("[server] 409: server mesh is in SIMULATION mode (set CSI_MESH_MODE=hardware).");
  } else if (code == 401) {
    Serial.println("[server] 401: DEVICE_KEY does not match CSI_DEVICE_KEY on Render.");
  } else if (code == 503) {
    Serial.println("[server] 503: CSI_DEVICE_KEY is not set on Render yet.");
  } else {
    Serial.printf("[server] post failed: %d %s\n", code, HTTPClient::errorToString(code).c_str());
  }
}

// ---------- Arduino entry points -------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(1500);
  snprintf(NODE_ID, sizeof(NODE_ID), "mesh-%d", NODE_NUM);
  Serial.printf("\n=== GhostSlot %s (mesh node) ===\n", NODE_ID);

  // Map the 52 usable subcarriers onto 8 slices of roughly equal size.
  int u = 0;
  for (int k = 0; k < SC_COUNT; k++) {
    groupOf[k] = 0;
    if (usable(k)) { groupOf[k] = (u * GROUPS) / 52; if (groupOf[k] >= GROUPS) groupOf[k] = GROUPS - 1; u++; }
  }
  memset(src, 0, sizeof(src));

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  connectWifi();
  Serial.printf("[info] my MAC: %s\n", WiFi.macAddress().c_str());
  setupMesh();
  xTaskCreate(pingTask, "ping", 3072, nullptr, 2, nullptr);
}

void loop() {
  static uint32_t lastReport = millis();
  connectWifi();
  if (millis() - lastReport >= REPORT_EVERY_MS) {
    lastReport = millis();
    if (WiFi.status() == WL_CONNECTED) report();
    else if (httpOpen) closeHttp();
  }
  delay(20);
}
