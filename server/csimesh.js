// CSI MESH engine for the Demo Room: estimates HOW MANY people are in the room.
//
// Up to four boards (mesh-1 .. mesh-4) sit in the room's corners. Every board
// pings the others and reports, per link, a 2-second summary of the Wi-Fi
// channel (see hardware/gs_mesh_node). This module:
//
//   1. stores the latest reading of every directed link (e.g. mesh-2 > mesh-1)
//   2. every 2 s builds ONE feature row from all links (fixed column order,
//      see FEATURE_NAMES) — the two directions of a pair are averaged
//   3. while a labelled recording is running, saves that row with the true
//      people count, so a model can be trained on it (tools/train_count_model.py)
//   4. if a trained model is present (server/models/mesh-count.json), predicts
//      the count live: 0, 1, 2, 3, 4 or 5+, with a confidence
//   5. if a zone model is present too (server/models/mesh-zone.json) and the
//      count is exactly 1, says which zone that person is in: front, back,
//      left, right or centre. Zone-level only: 4 boards can't give exact spots.
//
// Honesty rules, enforced here:
//   - No model loaded = no count. The status says so; nothing is invented.
//   - SIMULATION mode is for UI work without boards. Its count comes from the
//     simulator itself and is tagged source: "simulation" on every response.
//   - A model only knows the room it was trained in. Accuracy reported in the
//     status is the held-out test accuracy written by the training script.
//
// Routes (mounted under /api):
//   POST /csi/mesh                 board posts its links      (X-Device-Key)
//   GET  /csi/mesh/status          live status, public        (no secrets)
//   POST /csi/mesh/record          start/stop labelled recording (X-Admin-Key)
//   GET  /csi/mesh/export          download recordings as CSV (X-Admin-Key)
//   POST /csi/mesh/clear           delete recordings          (X-Admin-Key)
//   POST /csi/mesh/mode            hardware <-> simulation    (X-Admin-Key)

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireDeviceKey, requireAdminKey } from "./csi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const NODES = ["mesh-1", "mesh-2", "mesh-3", "mesh-4"];
// People counts the model can learn (0..10). "5+" is kept only so older recordings stay valid.
export const CLASSES = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
export const LEGACY_LABELS = ["5+"];
// Zone mode: with exactly ONE person inside, which part of the room are they in?
// front = the side with boards 1 and 2, back = boards 3 and 4,
// left = boards 1 and 3, right = boards 2 and 4, centre = where the diagonals cross.
export const ZONES = ["front", "back", "left", "right", "centre"];
export const ZONE_LABELS = ZONES.map((z) => `z-${z}`);
export const ALL_LABELS = [...CLASSES, ...LEGACY_LABELS, ...ZONE_LABELS];
export const GROUPS = 8;

// The 6 undirected pairs, always in this order.
export const PAIRS = [];
for (let i = 0; i < NODES.length; i++)
  for (let j = i + 1; j < NODES.length; j++) PAIRS.push([NODES[i], NODES[j]]);

const pairName = ([a, b]) => `p${a.slice(5)}-${b.slice(5)}`;
const PER_PAIR = ["motion", "rssi", ...Array.from({ length: GROUPS }, (_, g) => `prof${g}`)];

// Column order of every feature row. The model file must match it exactly.
export const FEATURE_NAMES = [
  ...PAIRS.flatMap((p) => PER_PAIR.map((f) => `${pairName(p)}_${f}`)),
  "motion_mean", "motion_max", "motion_std", "links_present",
];
export const MISSING = -1; // value used when a pair wasn't heard

const CONFIG = {
  windowMs: intEnv("CSI_MESH_WINDOW_MS", 2000),
  staleMs: intEnv("CSI_MESH_STALE_MS", 5000),       // older link readings are ignored
  minLinks: intEnv("CSI_MESH_MIN_PAIRS", 2),        // pairs needed before predicting
  smoothWindows: intEnv("CSI_MESH_SMOOTH", 6),
  quietMotion: intEnv("CSI_MESH_QUIET", 0),         // motion below this = no movement (0 = use the levels cut-off)      // average the last N predictions (6 x 2 s = 12 s)
  maxRows: intEnv("CSI_MESH_MAX_ROWS", 20000),      // ~11 hours of recording
  nodeTimeoutMs: intEnv("CSI_MESH_NODE_TIMEOUT_MS", 15000),
};

function intEnv(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : fallback;
}
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

// Checks one board post. Returns { ok, links } or { ok:false, error }.
export function validatePost(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "bad_body" };
  const { nodeId, links } = body;
  if (!NODES.includes(nodeId)) return { ok: false, error: "invalid_nodeId" };
  if (!Array.isArray(links) || links.length > NODES.length + 2) return { ok: false, error: "invalid_links" };
  const clean = [];
  for (const l of links) {
    if (!l || typeof l !== "object") return { ok: false, error: "invalid_link" };
    const { from, frames, motion, rssi, profile } = l;
    if (!NODES.includes(from) || from === nodeId) return { ok: false, error: "invalid_from" };
    if (!Number.isInteger(frames) || frames < 0 || frames > 2000) return { ok: false, error: "invalid_frames" };
    if (!isNum(motion, 0, 100000)) return { ok: false, error: "invalid_motion" };
    if (!isNum(rssi, -127, 0)) return { ok: false, error: "invalid_rssi" };
    if (!Array.isArray(profile) || profile.length !== GROUPS || !profile.every((x) => isNum(x, 0, 1000)))
      return { ok: false, error: "invalid_profile" };
    clean.push({ from, frames, motion, rssi, profile: profile.slice() });
  }
  return { ok: true, nodeId, links: clean };
}
function isNum(x, lo, hi) { return typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi; }

// latest: Map "from>to" -> { ts, motion, rssi, profile }. Returns a feature row.
export function buildFeatures(latest, now, staleMs = CONFIG.staleMs) {
  const row = [];
  const motions = [];
  for (const [a, b] of PAIRS) {
    const dirs = [latest.get(`${a}>${b}`), latest.get(`${b}>${a}`)]
      .filter((r) => r && now - r.ts <= staleMs);
    if (dirs.length === 0) {
      for (let k = 0; k < PER_PAIR.length; k++) row.push(MISSING);
      continue;
    }
    const avg = (f) => dirs.reduce((s, r) => s + f(r), 0) / dirs.length;
    const motion = avg((r) => r.motion);
    motions.push(motion);
    row.push(round(motion, 3), round(avg((r) => r.rssi), 2));
    for (let g = 0; g < GROUPS; g++) row.push(round(avg((r) => r.profile[g]), 3));
  }
  const n = motions.length;
  const mean = n ? motions.reduce((s, x) => s + x, 0) / n : MISSING;
  const max = n ? Math.max(...motions) : MISSING;
  const std = n > 1 ? Math.sqrt(motions.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : n === 1 ? 0 : MISSING;
  row.push(n ? round(mean, 3) : MISSING, n ? round(max, 3) : MISSING, n ? round(std, 3) : MISSING, n);
  return row;
}

// Random-forest model exported by tools/train_count_model.py.
export function validateModel(m) {
  if (!m || m.type !== "random_forest") return "not a random_forest model";
  if (!Array.isArray(m.featureNames) || m.featureNames.join("|") !== FEATURE_NAMES.join("|"))
    return "feature columns don't match this server (retrain with the current recordings)";
  if (!Array.isArray(m.classes) || m.classes.length < 2) return "bad classes";
  if (!Array.isArray(m.trees) || m.trees.length === 0) return "no trees";
  for (const t of m.trees) {
    const n = t.f?.length;
    if (!n || ![t.t, t.l, t.r, t.v].every((a) => Array.isArray(a) && a.length === n)) return "bad tree arrays";
    for (let i = 0; i < n; i++) {
      if (t.l[i] === -1) {
        if (!Array.isArray(t.v[i]) || t.v[i].length !== m.classes.length) return "bad leaf";
      } else if (!(t.l[i] > i && t.l[i] < n && t.r[i] > i && t.r[i] < n && t.f[i] >= 0 && t.f[i] < FEATURE_NAMES.length)) {
        return "bad tree structure";
      }
    }
  }
  return null;
}

// Average of every tree's leaf class distribution.
export function predictProba(model, row) {
  const probs = new Array(model.classes.length).fill(0);
  for (const t of model.trees) {
    let i = 0;
    while (t.l[i] !== -1) i = row[t.f[i]] <= t.t[i] ? t.l[i] : t.r[i];
    const leaf = t.v[i];
    const sum = leaf.reduce((s, x) => s + x, 0) || 1;
    for (let c = 0; c < probs.length; c++) probs[c] += leaf[c] / sum;
  }
  return probs.map((p) => p / model.trees.length);
}

export function toCsv(rows) {
  const head = ["t", "session", "label", "source", ...FEATURE_NAMES].join(",");
  const lines = rows.map((r) => [new Date(r.t).toISOString(), r.session, r.label, r.source, ...r.features].join(","));
  return [head, ...lines].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Supabase storage for recordings (table gs_mesh_rows, migration 0007).
// Render's free disk is wiped on every deploy, so this is where recordings
// should live in production. Used automatically when SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are set.
// ---------------------------------------------------------------------------
export function supabaseRemote(url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY) {
  if (!url || !key) return null;
  let clientPromise = null;
  const sb = () => (clientPromise ||= import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })));
  return {
    async insert(row) {
      const c = await sb();
      const r = await c.from("gs_mesh_rows").insert({
        t: new Date(row.t).toISOString(), session: row.session, label: row.label, source: row.source, features: row.features,
      });
      if (r.error) throw new Error(r.error.message);
    },
    async loadAll(limit) {
      const c = await sb();
      const out = [];
      for (let from = 0; out.length < limit; from += 1000) {
        const r = await c.from("gs_mesh_rows").select("t,session,label,source,features")
          .order("id", { ascending: true }).range(from, from + 999);
        if (r.error) throw new Error(r.error.message);
        for (const x of r.data) out.push({ t: Date.parse(x.t), session: x.session, label: x.label, source: x.source, features: x.features });
        if (r.data.length < 1000) break;
      }
      return out.slice(-limit);
    },
    async clear() {
      const c = await sb();
      const r = await c.from("gs_mesh_rows").delete().gte("id", 0);
      if (r.error) throw new Error(r.error.message);
    },
  };
}

// ---------------------------------------------------------------------------
// Engine (one per server; tests create their own with fake time)
// ---------------------------------------------------------------------------
export function createMeshEngine(opts = {}) {
  const now = opts.now || (() => Date.now());
  const remote = opts.remote === undefined ? supabaseRemote() : opts.remote; // null = no Supabase
  const dataFile = remote ? null : opts.dataFile === undefined
    ? path.join(process.env.DATA_DIR || path.join(__dirname, "data"), "mesh-recordings.jsonl")
    : opts.dataFile; // null = memory only
  const modelPath = opts.modelPath === undefined
    ? process.env.CSI_MESH_MODEL || path.join(__dirname, "models", "mesh-count.json")
    : opts.modelPath;
  const levelsPath = opts.levelsPath === undefined
    ? process.env.CSI_MESH_LEVELS || path.join(__dirname, "models", "mesh-levels.json")
    : opts.levelsPath;
  const zoneModelPath = opts.zoneModelPath === undefined
    ? process.env.CSI_MESH_ZONE_MODEL || path.join(__dirname, "models", "mesh-zone.json")
    : opts.zoneModelPath;

  const s = {
    mode: String(opts.mode || process.env.CSI_MESH_MODE || "simulation").trim().toLowerCase() === "hardware" ? "hardware" : "simulation",
    latest: new Map(),
    nodeSeen: Object.fromEntries(NODES.map((n) => [n, null])),
    rows: [],
    recording: null,             // { label, session, startedAt }
    lastFeatures: null,
    lastWindowAt: null,
    recentProbs: [],
    recentZoneProbs: [],
    prediction: null,
    model: null,
    modelError: null,
    zoneModel: null,
    zoneModelError: null,
    levels: null,                // calibrated occupancy levels (used when no count model)
    levelsError: null,
    recentMotion: [],
    sim: { count: 0, zone: 0, ticksLeft: 0 },
  };

  // ---- model ----
  function readModel(file, allowed) {
    if (!file || !fs.existsSync(file)) return { model: null, error: "no model trained yet" };
    try {
      const m = JSON.parse(fs.readFileSync(file, "utf8"));
      const err = validateModel(m) || (m.classes.every((c) => allowed.includes(c)) ? null : "unexpected classes in model");
      return err ? { model: null, error: err } : { model: m, error: null };
    } catch {
      return { model: null, error: "model file unreadable" };
    }
  }
  function readLevels(file) {
    if (!file || !fs.existsSync(file)) return { levels: null, error: "no level calibration yet" };
    try {
      const m = JSON.parse(fs.readFileSync(file, "utf8"));
      const th = m && m.thresholds;
      const ok = m && m.kind === "levels" && m.feature === "motion_mean"
        && Array.isArray(m.classes) && Array.isArray(th) && th.length === m.classes.length - 1
        && th.every((x, i) => Number.isFinite(x) && (i === 0 || x > th[i - 1]))
        && Number.isInteger(m.window) && m.window >= 1 && m.window <= 60
        && m.classes.every((c) => typeof c === "string" && c.length <= 4);
      return ok ? { levels: m, error: null } : { levels: null, error: "level calibration file is invalid" };
    } catch {
      return { levels: null, error: "level calibration file unreadable" };
    }
  }
  function loadModel() {
    ({ model: s.model, error: s.modelError } = readModel(modelPath, [...CLASSES, ...LEGACY_LABELS]));
    ({ levels: s.levels, error: s.levelsError } = readLevels(levelsPath));
    ({ model: s.zoneModel, error: s.zoneModelError } = readModel(zoneModelPath, ZONES));
  }
  loadModel();

  // ---- recordings on disk (best effort; Render's free disk is wiped on deploy) ----
  if (dataFile && fs.existsSync(dataFile)) {
    try {
      for (const line of fs.readFileSync(dataFile, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const r = JSON.parse(line);
        if (Array.isArray(r.features) && r.features.length === FEATURE_NAMES.length) s.rows.push(r);
      }
      s.rows = s.rows.slice(-CONFIG.maxRows);
    } catch { /* a corrupt file just means starting fresh */ }
  }
  // Rows already stored in Supabase come back on start (after a redeploy).
  let remoteWarned = false;
  const warnRemote = (e) => {
    if (!remoteWarned) console.warn("[mesh] Supabase storage problem, keeping rows in memory:", e.message);
    remoteWarned = true;
  };
  const remoteReady = remote
    ? remote.loadAll(CONFIG.maxRows).then((stored) => {
        const ok = stored.filter((r) => Array.isArray(r.features) && r.features.length === FEATURE_NAMES.length);
        s.rows = [...ok, ...s.rows].slice(-CONFIG.maxRows);
      }).catch(warnRemote)
    : Promise.resolve();

  function persist(row) {
    if (remote) { remote.insert(row).catch(warnRemote); return; }
    if (!dataFile) return;
    try {
      fs.mkdirSync(path.dirname(dataFile), { recursive: true });
      fs.appendFileSync(dataFile, JSON.stringify(row) + "\n");
    } catch { /* memory copy still exists */ }
  }

  // ---- inputs ----
  function ingest(nodeId, links) {
    const t = now();
    s.nodeSeen[nodeId] = t;
    for (const l of links) s.latest.set(`${l.from}>${nodeId}`, { ts: t, motion: l.motion, rssi: l.rssi, profile: l.profile });
  }

  // Fake but plausible readings so the UI works without boards.
  function simulateReadings() {
    const sim = s.sim;
    if (sim.ticksLeft <= 0) {
      sim.count = Math.floor(Math.random() * CLASSES.length);
      sim.zone = Math.floor(Math.random() * ZONES.length);
      sim.ticksLeft = 8 + Math.floor(Math.random() * 8);
    }
    sim.ticksLeft--;
    const t = now();
    for (const rx of NODES) {
      s.nodeSeen[rx] = t;
      for (const tx of NODES) {
        if (tx === rx) continue;
        const busy = sim.count;
        const motion = 4 + busy * 9 + Math.random() * (3 + busy * 4);
        const profile = Array.from({ length: GROUPS }, (_, g) => 20 + g - busy * 1.2 + Math.random() * 1.5);
        s.latest.set(`${tx}>${rx}`, { ts: t, motion, rssi: -45 - busy - Math.random() * 3, profile });
      }
    }
  }

  // Average the last few probability vectors so the answer doesn't flicker.
  function smoothed(buffer, p) {
    buffer.push(p);
    if (buffer.length > CONFIG.smoothWindows) buffer.shift();
    const avg = p.map((_, c) => buffer.reduce((sum, q) => sum + q[c], 0) / buffer.length);
    let best = 0;
    for (let c = 1; c < avg.length; c++) if (avg[c] > avg[best]) best = c;
    return { avg, best };
  }

  // ---- one 2-second window ----
  function tick() {
    if (s.mode === "simulation") simulateReadings();
    const t = now();
    const features = buildFeatures(s.latest, t);
    const pairsHeard = features[features.length - 1];
    s.lastFeatures = features;
    s.lastWindowAt = t;

    if (s.recording && pairsHeard >= 1) {
      const row = { t, session: s.recording.session, label: s.recording.label, source: s.mode, features };
      s.rows.push(row);
      if (s.rows.length > CONFIG.maxRows) s.rows.shift();
      persist(row);
    }

    if (s.mode === "simulation") {
      const label = CLASSES[s.sim.count];
      s.prediction = { label, confidence: null, source: "simulation", at: t,
        zone: label === "1" ? { label: ZONES[s.sim.zone], confidence: null } : null };
    } else if (s.model && pairsHeard >= CONFIG.minLinks) {
      // Wi-Fi CSI sees MOVEMENT. If overall motion stays at the empty-room level,
      // the room is empty or everyone is sitting very still, and a count would be a
      // guess. Say so instead of inventing a number.
      s.recentMotion.push(features[FEATURE_NAMES.indexOf("motion_mean")]);
      if (s.recentMotion.length > 5) s.recentMotion.shift();
      const quietAt = CONFIG.quietMotion || (s.levels ? s.levels.thresholds[0] : 0);
      const motionAvg = s.recentMotion.reduce((a, b) => a + b, 0) / s.recentMotion.length;
      const { avg, best } = smoothed(s.recentProbs, predictProba(s.model, features));
      // Low motion: trust the model only when it says "empty"; otherwise don't guess.
      if (quietAt > 0 && s.recentMotion.length >= 3 && motionAvg < quietAt && s.model.classes[best] !== "0") {
        s.prediction = { label: "quiet", confidence: null, zone: null, source: "model", quiet: true, motion: round(motionAvg, 1), at: t };
        return;
      }
      const label = s.model.classes[best];
      // A zone is only meaningful for one person: with 2+ people their signals overlap.
      let zone = null;
      if (label === "1" && s.zoneModel) {
        const z = smoothed(s.recentZoneProbs, predictProba(s.zoneModel, features));
        zone = { label: s.zoneModel.classes[z.best], confidence: round(z.avg[z.best], 3) };
      } else {
        s.recentZoneProbs = [];
      }
      // Expected count and a likely range from the smoothed class probabilities:
      // steadier than the single top class when many people are inside.
      const nums = s.model.classes.map((c) => (c === "5+" ? 5 : Number(c)));
      const estimate = avg.reduce((acc, p, i) => acc + p * nums[i], 0);
      const order = nums.map((n, i) => [n, avg[i]]).sort((a, b) => a[0] - b[0]);
      const quantile = (q) => { let c = 0; for (const [n, p] of order) { c += p; if (c >= q) return n; } return order[order.length - 1][0]; };
      s.prediction = {
        label,
        confidence: round(avg[best], 3),
        estimate: round(estimate, 1),
        range: [quantile(0.15), quantile(0.85)],
        probs: Object.fromEntries(s.model.classes.map((c, i) => [c, round(avg[i], 3)])),
        zone,
        source: "model",
        at: t,
      };
    } else if (s.levels && pairsHeard >= Math.max(CONFIG.minLinks, s.levels.minPairs || 0)) {
      // Calibrated occupancy levels: average overall motion over the last
      // `window` windows and compare with thresholds learned from labelled
      // recordings in this room (tools/mesh/calibrate_levels.py).
      const L = s.levels;
      const level = (v) => { let i = 0; while (i < L.thresholds.length && v >= L.thresholds[i]) i++; return i; };
      s.recentMotion.push(features[FEATURE_NAMES.indexOf("motion_mean")]);
      if (s.recentMotion.length > L.window) s.recentMotion.shift();
      if (s.recentMotion.length < Math.min(3, L.window)) { s.prediction = null; return; }
      const avg = s.recentMotion.reduce((a, b) => a + b, 0) / s.recentMotion.length;
      const best = level(avg);
      // Confidence = share of the recent windows that, on their own, fall in the same level.
      const agree = s.recentMotion.filter((v) => level(v) === best).length / s.recentMotion.length;
      // With exactly one person, a zone model (if trained) says where they are.
      let zone = null;
      if ((L.classes[best] === "1" || L.classes[best] === "1+") && s.zoneModel) {
        const z = smoothed(s.recentZoneProbs, predictProba(s.zoneModel, features));
        zone = { label: s.zoneModel.classes[z.best], confidence: round(z.avg[z.best], 3) };
      } else {
        s.recentZoneProbs = [];
      }
      s.prediction = { label: L.classes[best], confidence: round(agree, 3), zone, source: "levels", at: t };
    } else {
      s.recentProbs = [];
      s.recentZoneProbs = [];
      s.recentMotion = [];
      s.prediction = null;
    }
  }

  // ---- controls ----
  function startRecording(label) {
    if (!ALL_LABELS.includes(label)) return { ok: false, error: "label must be one of " + ALL_LABELS.join(", ") };
    s.recording = { label, session: `s${now().toString(36)}`, startedAt: now() };
    return { ok: true };
  }
  function stopRecording() { s.recording = null; return { ok: true }; }
  function clear() {
    s.rows = [];
    if (remote) remote.clear().catch(warnRemote);
    if (dataFile) { try { fs.rmSync(dataFile, { force: true }); } catch { /* ignore */ } }
  }
  function setMode(mode) {
    s.mode = mode;
    s.latest.clear();
    s.recentProbs = [];
    s.recentZoneProbs = [];
    s.recentMotion = [];
    s.prediction = null;
  }

  function status() {
    const t = now();
    const counts = Object.fromEntries(ALL_LABELS.map((c) => [c, 0]));
    const sessions = new Set();
    for (const r of s.rows) { counts[r.label] = (counts[r.label] || 0) + 1; sessions.add(r.session); }
    const links = [];
    for (const [key, r] of s.latest) {
      if (t - r.ts > CONFIG.staleMs) continue;
      const [from, to] = key.split(">");
      links.push({ from, to, motion: round(r.motion, 1), rssi: round(r.rssi, 1) });
    }
    const pairsHeard = s.lastFeatures ? s.lastFeatures[s.lastFeatures.length - 1] : 0;
    return {
      roomId: "demo-room",
      mode: s.mode,
      nodes: Object.fromEntries(NODES.map((n) => [n, {
        online: s.nodeSeen[n] != null && t - s.nodeSeen[n] <= CONFIG.nodeTimeoutMs,
        lastSeen: s.nodeSeen[n] ? new Date(s.nodeSeen[n]).toISOString() : null,
      }])),
      links,
      pairsHeard,
      prediction: s.prediction,
      model: s.model
        ? { loaded: true, classes: s.model.classes, trainedAt: s.model.meta?.trainedAt || null,
            testAccuracy: s.model.meta?.testAccuracy ?? null, withinOneAccuracy: s.model.meta?.withinOneAccuracy ?? null,
            trainRows: s.model.meta?.trainRows ?? null }
        : s.levels
          ? { loaded: true, kind: "levels", classes: s.levels.classes, trainedAt: s.levels.meta?.trainedAt || null,
              testAccuracy: s.levels.meta?.testAccuracy ?? null, withinOneAccuracy: null, trainRows: s.levels.meta?.trainRows ?? null }
          : { loaded: false, reason: s.modelError },
      zoneModel: s.zoneModel
        ? { loaded: true, classes: s.zoneModel.classes, trainedAt: s.zoneModel.meta?.trainedAt || null,
            testAccuracy: s.zoneModel.meta?.testAccuracy ?? null, trainRows: s.zoneModel.meta?.trainRows ?? null }
        : { loaded: false, reason: s.zoneModelError },
      recording: {
        storage: remote ? "supabase" : dataFile ? "file" : "memory",
        active: !!s.recording,
        label: s.recording?.label || null,
        rowsByLabel: counts,
        totalRows: s.rows.length,
        sessions: sessions.size,
      },
      config: { ...CONFIG },
    };
  }

  return { ingest, tick, startRecording, stopRecording, clear, setMode, status, loadModel, ready: remoteReady,
    exportCsv: () => toCsv(s.rows), get mode() { return s.mode; } };
}

// ---------------------------------------------------------------------------
// Express router
// ---------------------------------------------------------------------------
export function buildMeshRouter(engine) {
  const router = express.Router();

  router.post("/csi/mesh", requireDeviceKey, (req, res) => {
    if (engine.mode !== "hardware") return res.status(409).json({ error: "not_in_hardware_mode", mode: engine.mode });
    const v = validatePost(req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    engine.ingest(v.nodeId, v.links);
    res.json({ ok: true });
  });

  router.get("/csi/mesh/status", (_req, res) => res.json(engine.status()));

  router.post("/csi/mesh/record", requireAdminKey, (req, res) => {
    const label = (req.body || {}).label;
    if (label === null || label === undefined || label === "stop") return res.json({ ...engine.stopRecording(), status: engine.status() });
    const r = engine.startRecording(String(label));
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, status: engine.status() });
  });

  router.get("/csi/mesh/export", requireAdminKey, (_req, res) => {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="mesh-recordings.csv"');
    res.send(engine.exportCsv());
  });

  router.post("/csi/mesh/clear", requireAdminKey, (_req, res) => {
    engine.clear();
    res.json({ ok: true, status: engine.status() });
  });

  router.post("/csi/mesh/mode", requireAdminKey, (req, res) => {
    const mode = (req.body || {}).mode;
    if (!["hardware", "simulation"].includes(mode)) return res.status(400).json({ error: "mode must be 'hardware' or 'simulation'" });
    engine.setMode(mode);
    res.json({ ok: true, status: engine.status() });
  });

  return router;
}

// Server-wide instance, ticking every window.
export const meshEngine = createMeshEngine();
export const meshRouter = buildMeshRouter(meshEngine);
setInterval(() => meshEngine.tick(), CONFIG.windowMs).unref?.();
