// CSI (Wi-Fi Channel State Information) engine for the Demo Room.
//
// This module owns the ONLY CSI-enabled room in the prototype ("demo-room").
// It exposes an Express router with:
//   POST /api/csi/demo-room            — a physical ESP32-S3 node pushes one reading
//   GET  /api/csi/status               — current room status for the Web UI / OLED / CampusAI
//   POST /api/csi/demo-room/calibrate  — restart calibration (dev/debug utility)
//   POST /api/csi/mode                 — switch REAL HARDWARE <-> SIMULATION (dev/debug utility)
//
// Design notes (see README / project spec for the full rationale):
// - Two ESP32-S3-WROOM-1 boards form the sensing pair ("node-a" transmitter,
//   "node-b" receiver in the reference wiring). Each posts a single scalar
//   CSI amplitude-variation feature per sample tick to POST /api/csi/demo-room.
//   Computing that feature from the raw CSI subcarrier array is done on the
//   ESP32 firmware side (out of scope for this Node backend) — the exact
//   transmitter/receiver roles and feature extraction depend on whichever
//   ESP32 CSI toolkit (e.g. ESP-IDF's wifi_csi or the Espressif CSI SDK) the
//   hardware team wires up; this backend only ever consumes the resulting
//   validated numeric feature, and never fabricates one from thin air.
// - SIMULATION mode exists purely for development/demo without hardware
//   attached. It runs the exact same validation/smoothing/baseline/change-
//   detection pipeline as real hardware data — it just generates the input
//   samples instead of reading them from a POST body. Every simulated value
//   is clearly tagged so the UI can show a "SIMULATION MODE" banner and never
//   present it as a real measurement.
// - CSI here answers ONE question: "did the room's Wi-Fi channel change
//   meaningfully from its calibrated baseline?" It intentionally does NOT
//   claim occupancy, a people count, or identity — see CHANGE_DETECTED vs.
//   occupancy in the docs.

import express from "express";
import crypto from "node:crypto";

// ---- Device / admin authentication ----------------------------------------
// The ESP32 nodes and the OLED send `X-Device-Key: <CSI_DEVICE_KEY>`.
// Calibrate / mode switching need `X-Admin-Key: <CSI_ADMIN_KEY>`.
// If a key isn't configured, the matching endpoints are switched OFF
// (fail closed) instead of being open to anyone on the network.
function keyMatches(given, expected) {
  if (!expected || typeof given !== "string") return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
export function requireDeviceKey(req, res, next) {
  if (!process.env.CSI_DEVICE_KEY) return res.status(503).json({ error: "device_key_not_configured" });
  if (!keyMatches(req.get("x-device-key"), process.env.CSI_DEVICE_KEY)) return res.status(401).json({ error: "bad_device_key" });
  next();
}
export function requireAdminKey(req, res, next) {
  if (!process.env.CSI_ADMIN_KEY) return res.status(403).json({ error: "admin_endpoints_disabled" });
  if (!keyMatches(req.get("x-admin-key"), process.env.CSI_ADMIN_KEY)) return res.status(401).json({ error: "bad_admin_key" });
  next();
}

const ROOM_ID = "demo-room";

// ---- Configurable parameters (documented, not arbitrary) -----------------
// All of these can be overridden via environment variables so the demo can
// be tuned to the room/hardware without code changes.
const CONFIG = {
  // Expected/target interval between samples (ms). Used to size the
  // simulation ticker and to reason about the offline timeout below.
  sampleRateMs: intEnv("CSI_SAMPLE_RATE_MS", 2000),
  // Number of valid smoothed samples needed to establish a baseline.
  baselineWindow: intEnv("BASELINE_WINDOW", 15),
  // Moving-average window applied to raw readings before baseline
  // comparison, to reduce single-sample noise.
  smoothingWindow: intEnv("SMOOTHING_WINDOW", 5),
  // Change is flagged when |smoothed - baseline.mean| / baseline.std
  // exceeds this many standard deviations.
  changeThreshold: floatEnv("CHANGE_THRESHOLD", 2.5),
  // If no valid sample has been received for this long, the room is
  // reported OFFLINE regardless of its last known state.
  offlineTimeoutMs: intEnv("CSI_OFFLINE_TIMEOUT_MS", 15000),
  // A board counts as online if it checked in within this window. Longer
  // than the room timeout: heartbeats go over HTTPS on a phone hotspot and
  // one slow or dropped check-in should not flip a working board to offline.
  deviceTimeoutMs: intEnv("CSI_DEVICE_TIMEOUT_MS", 30000),
};

function intEnv(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : fallback;
}
function floatEnv(name, fallback) {
  const v = parseFloat(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

// ---- Mutable engine state (single demo room, in-memory) -------------------
const state = {
  // "hardware" | "simulation" — which source feeds the pipeline right now.
  // Trimmed + lower-cased so " Hardware " pasted into a dashboard still works.
  mode: String(process.env.CSI_MODE || "simulation").trim().toLowerCase() === "hardware" ? "hardware" : "simulation",
  // "UNKNOWN" | "CALIBRATING" | "NORMAL" | "CHANGE_DETECTED" | "OFFLINE"
  csiState: "UNKNOWN",
  // "NOT_STARTED" | "CALIBRATING" | "ESTABLISHED"
  calibrationStatus: "NOT_STARTED",
  baseline: null, // { mean, std }
  baselineSamples: [], // smoothed values collected while calibrating
  rawBuffer: [], // recent raw values, for the smoothing window
  samplesCollected: 0,
  lastCsiUpdate: null, // Date | null
  lastSource: null, // "hardware" | "simulation"
  devices: {
    "node-a": { lastSeen: null },
    "node-b": { lastSeen: null },
    oled: { lastSeen: null },
  },
};

function deviceOnline(dev) {
  if (!dev.lastSeen) return false;
  return Date.now() - dev.lastSeen.getTime() <= CONFIG.deviceTimeoutMs;
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function stddev(arr, avg) {
  if (arr.length < 2) return 0;
  const variance = arr.reduce((a, b) => a + (b - avg) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function resetCalibration() {
  state.calibrationStatus = "NOT_STARTED";
  state.baseline = null;
  state.baselineSamples = [];
  state.rawBuffer = [];
  state.csiState = "UNKNOWN";
}

// Core processing pipeline: Validation -> Noise filtering / smoothing ->
// Feature is already the raw value here (amplitude-variation scalar from the
// firmware) -> Baseline comparison -> Change detection.
function ingestReading({ value, nodeId, source }) {
  // 1. Validation — reject anything that isn't a finite, plausible number.
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10000) {
    return { accepted: false, reason: "invalid_value" };
  }

  const now = new Date();
  if (nodeId && state.devices[nodeId]) state.devices[nodeId].lastSeen = now;

  // 2. Noise filtering / smoothing — simple moving average over the
  // configured window of recent raw readings.
  state.rawBuffer.push(value);
  if (state.rawBuffer.length > CONFIG.smoothingWindow) state.rawBuffer.shift();
  const smoothed = mean(state.rawBuffer);

  state.samplesCollected += 1;
  state.lastCsiUpdate = now;
  state.lastSource = source;

  // 3. Baseline comparison / calibration.
  if (state.calibrationStatus !== "ESTABLISHED") {
    state.calibrationStatus = "CALIBRATING";
    state.csiState = "CALIBRATING";
    state.baselineSamples.push(smoothed);
    if (state.baselineSamples.length >= CONFIG.baselineWindow) {
      const avg = mean(state.baselineSamples);
      const sd = stddev(state.baselineSamples, avg);
      state.baseline = { mean: avg, std: sd || 1e-6 };
      state.calibrationStatus = "ESTABLISHED";
      state.csiState = "NORMAL";
    }
    return { accepted: true, smoothed };
  }

  // 4. Change detection — z-score against the established baseline.
  const z = Math.abs(smoothed - state.baseline.mean) / state.baseline.std;
  state.csiState = z > CONFIG.changeThreshold ? "CHANGE_DETECTED" : "NORMAL";
  return { accepted: true, smoothed, z };
}

// Periodically re-evaluate offline status: if no valid sample has arrived
// within the configured timeout, the room reports OFFLINE regardless of the
// last computed state. This runs independently of which mode is active.
setInterval(() => {
  if (!state.lastCsiUpdate) {
    // Never received a sample: stay UNKNOWN briefly, then OFFLINE once the
    // hardware clearly isn't there (only meaningful in hardware mode).
    if (state.mode === "hardware") state.csiState = "OFFLINE";
    return;
  }
  const age = Date.now() - state.lastCsiUpdate.getTime();
  if (age > CONFIG.offlineTimeoutMs) {
    state.csiState = "OFFLINE";
  }
}, Math.min(2000, CONFIG.offlineTimeoutMs)).unref?.(); // timers never keep the process alive on their own

// ---- Simulation ticker ------------------------------------------------
// Only active while state.mode === "simulation". Feeds the exact same
// ingestReading() pipeline real hardware would, so the rest of the system
// (UI, CampusAI, OLED) can't tell the difference except via the "mode" field
// every response carries.
let simTimer = null;
function startSimulation() {
  stopSimulation();
  const baselineCenter = 50;
  let changeBurstTicksLeft = 0;
  simTimer = setInterval(() => {
    if (state.mode !== "simulation") return;
    const now = new Date();
    state.devices["node-a"].lastSeen = now;
    state.devices["node-b"].lastSeen = now;
    state.devices.oled.lastSeen = now; // simulated OLED assumed reachable too

    // Occasionally simulate a burst of activity so CHANGE_DETECTED is
    // demonstrable without hardware.
    if (changeBurstTicksLeft <= 0 && Math.random() < 0.06) changeBurstTicksLeft = 3 + Math.floor(Math.random() * 3);
    const noise = (Math.random() - 0.5) * 6; // +/-3
    const value = changeBurstTicksLeft > 0 ? baselineCenter + 22 + noise : baselineCenter + noise;
    if (changeBurstTicksLeft > 0) changeBurstTicksLeft -= 1;

    ingestReading({ value, nodeId: "node-a", source: "simulation" });
  }, CONFIG.sampleRateMs);
  simTimer.unref?.();
}
function stopSimulation() {
  if (simTimer) clearInterval(simTimer);
  simTimer = null;
}
if (state.mode === "simulation") startSimulation();

function publicStatus() {
  const secondsSinceUpdate = state.lastCsiUpdate ? Math.round((Date.now() - state.lastCsiUpdate.getTime()) / 1000) : null;
  return {
    roomId: ROOM_ID,
    mode: state.mode, // "hardware" | "simulation" — UI must always show this
    state: state.csiState,
    calibrationStatus: state.calibrationStatus,
    // Readings collected toward the current baseline (resets on recalibrate).
    calibrationProgress: state.baselineSamples.length,
    baseline: state.baseline ? { mean: round2(state.baseline.mean), std: round2(state.baseline.std) } : null,
    samplesCollected: state.samplesCollected,
    lastCsiUpdate: state.lastCsiUpdate ? state.lastCsiUpdate.toISOString() : null,
    secondsSinceUpdate,
    devices: {
      "node-a": { online: deviceOnline(state.devices["node-a"]), lastSeen: iso(state.devices["node-a"].lastSeen) },
      "node-b": { online: deviceOnline(state.devices["node-b"]), lastSeen: iso(state.devices["node-b"].lastSeen) },
      oled: { online: deviceOnline(state.devices.oled), lastSeen: iso(state.devices.oled.lastSeen) },
    },
    config: { ...CONFIG },
  };
}
function iso(d) { return d ? d.toISOString() : null; }
function round2(n) { return Math.round(n * 100) / 100; }

export const router = express.Router();

// A real ESP32-S3 node (or the OLED, purely to mark itself "seen") posts here.
router.post("/csi/demo-room", express.json({ limit: "2kb" }), requireDeviceKey, (req, res) => {
  const { nodeId, value, heartbeat } = req.body || {};
  // Heartbeat: the transmitter (node-a) only sends packets for node-b to
  // measure, so it has no reading of its own. It reports "I'm alive" here;
  // nothing enters the CSI pipeline.
  if (heartbeat === true) {
    if (!["node-a", "node-b"].includes(nodeId)) return res.status(400).json({ error: "invalid_nodeId" });
    state.devices[nodeId].lastSeen = new Date();
    return res.json({ ok: true, status: publicStatus() });
  }
  if (state.mode !== "hardware") {
    return res.status(409).json({ error: "not_in_hardware_mode", mode: state.mode });
  }
  if (!["node-a", "node-b"].includes(nodeId)) {
    return res.status(400).json({ error: "invalid_nodeId" });
  }
  const result = ingestReading({ value, nodeId, source: "hardware" });
  if (!result.accepted) return res.status(400).json({ error: result.reason });
  return res.json({ ok: true, status: publicStatus() });
});

// The OLED (or anything else) can poll this for the current room status.
// A query param lets the OLED mark itself "seen" without needing its own
// write endpoint — see README for the exact polling contract.
router.get("/csi/status", (req, res) => {
  // Only a keyed OLED can mark itself "seen", so nobody can fake it online.
  if (req.query.device === "oled" && keyMatches(req.get("x-device-key"), process.env.CSI_DEVICE_KEY)) {
    state.devices.oled.lastSeen = new Date();
  }
  res.json(publicStatus());
});

// Dev/debug: force baseline recalibration.
router.post("/csi/demo-room/calibrate", requireAdminKey, (_req, res) => {
  resetCalibration();
  res.json({ ok: true, status: publicStatus() });
});

// Dev/debug: switch between REAL HARDWARE and SIMULATION.
router.post("/csi/mode", express.json({ limit: "1kb" }), requireAdminKey, (req, res) => {
  const mode = (req.body || {}).mode;
  if (!["hardware", "simulation"].includes(mode)) {
    return res.status(400).json({ error: "mode must be 'hardware' or 'simulation'" });
  }
  state.mode = mode;
  resetCalibration();
  if (mode === "simulation") startSimulation();
  else stopSimulation();
  res.json({ ok: true, status: publicStatus() });
});

export function getDemoRoomStatus() {
  // Exposed for other server modules (e.g. the CampusAI chat route) to pull
  // live CSI context without an extra HTTP hop.
  return publicStatus();
}
