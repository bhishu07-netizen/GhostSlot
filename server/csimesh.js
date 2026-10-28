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
export const CLASSES = ["0", "1", "2", "3", "4", "5+"];
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
  smoothWindows: intEnv("CSI_MESH_SMOOTH", 3),      // average the last N predictions
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

  const s = {
    mode: String(opts.mode || process.env.CSI_MESH_MODE || "simulation").trim().toLowerCase() === "hardware" ? "hardware" : "simulation",
    latest: new Map(),
    nodeSeen: Object.fromEntries(NODES.map((n) => [n, null])),
    rows: [],
    recording: null,             // { label, session, startedAt }
    lastFeatures: null,
    lastWindowAt: null,
    recentProbs: [],
    prediction: null,
    model: null,
    modelError: null,
    sim: { count: 0, ticksLeft: 0 },
  };

  // ---- model ----
  function loadModel() {
    s.model = null; s.modelError = null;
    if (!modelPath || !fs.existsSync(modelPath)) { s.modelError = "no model trained yet"; return; }
    try {
      const m = JSON.parse(fs.readFileSync(modelPath, "utf8"));
      const err = validateModel(m);
      if (err) { s.modelError = err; return; }
      s.model = m;
    } catch (e) {
      s.modelError = "model file unreadable";
    }
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
      s.prediction = { label: CLASSES[s.sim.count], confidence: null, source: "simulation", at: t };
    } else if (s.model && pairsHeard >= CONFIG.minLinks) {
      const p = predictProba(s.model, features);
      s.recentProbs.push(p);
      if (s.recentProbs.length > CONFIG.smoothWindows) s.recentProbs.shift();
      const avg = p.map((_, c) => s.recentProbs.reduce((sum, q) => sum + q[c], 0) / s.recentProbs.length);
      let best = 0;
      for (let c = 1; c < avg.length; c++) if (avg[c] > avg[best]) best = c;
      s.prediction = {
        label: s.model.classes[best],
        confidence: round(avg[best], 3),
        probs: Object.fromEntries(s.model.classes.map((c, i) => [c, round(avg[i], 3)])),
        source: "model",
        at: t,
      };
    } else {
      s.recentProbs = [];
      s.prediction = null;
    }
  }

  // ---- controls ----
  function startRecording(label) {
    if (!CLASSES.includes(label)) return { ok: false, error: "label must be one of " + CLASSES.join(", ") };
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
    s.prediction = null;
  }

  function status() {
    const t = now();
    const counts = Object.fromEntries(CLASSES.map((c) => [c, 0]));
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
        : { loaded: false, reason: s.modelError },
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
