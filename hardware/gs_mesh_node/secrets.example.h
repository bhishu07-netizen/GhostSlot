// Copy this file to secrets.h (same folder) and fill it in.
// secrets.h is git-ignored: never commit your Wi-Fi password or device key.
#pragma once

// 2.4 GHz Wi-Fi only (ESP32 can't join 5 GHz). Use your phone hotspot.
// iPhone: Settings > Personal Hotspot > turn ON "Maximise Compatibility".
#define WIFI_SSID   "YourHotspotName"
#define WIFI_PASS   "YourHotspotPassword"

// No slash at the end.
#define SERVER_URL  "https://ghostslot.onrender.com"

// The same long random string you set as CSI_DEVICE_KEY on Render.
#define DEVICE_KEY  "paste-your-device-key-here"
