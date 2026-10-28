// CSI mesh people-count engine: input validation, feature rows, the model
// format, labelled recording, CSV export and the route key checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CSI_DEVICE_KEY = "dev-key-xyz";
process.env.CSI_ADMIN_KEY = "admin-key-xyz";

const mesh = await import("../csimesh.js");
const { validatePost, buildFeatures, validateModel, predictProba, createMeshEngine, buildMeshRouter,
  FEATURE_NAMES, CLASSES, PAIRS, MISSING, GROUPS } = mesh;

const prof = (x) => Array.from({ length: GROUPS }, () => x);
const link = (from, motion = 10) => ({ from, frames: 90, motion, rssi: -50, profile: prof(20) });

test("validatePost accepts a good post and rejects bad ones", () => {
  assert.equal(validatePost({ nodeId: "mesh-1", links: [link("mesh-2")] }).ok, true);
  assert.equal(validatePost({ nodeId: "mesh-9", links: [] }).error, "invalid_nodeId");
  assert.equal(validatePost({ nodeId: "mesh-1", links: [link("mesh-1")] }).error, "invalid_from");
  assert.equal(validatePost({ nodeId: "mesh-1", links: [{ ...link("mesh-2"), motion: -1 }] }).error, "invalid_motion");
  assert.equal(validatePost({ nodeId: "mesh-1", links: [{ ...link("mesh-2"), profile: [1, 2] }] }).error, "invalid_profile");
  assert.equal(validatePost({ nodeId: "mesh-1", links: [{ ...link("mesh-2"), rssi: 5 }] }).error, "invalid_rssi");
  assert.equal(validatePost({ nodeId: "mesh-1", links: "x" }).error, "invalid_links");
});

test("feature row has a fixed shape, averages both directions and drops stale links", () => {
  assert.equal(FEATURE_NAMES.length, PAIRS.length * (2 + GROUPS) + 4);
  const latest = new Map([
    ["mesh-2>mesh-1", { ts: 1000, motion: 10, rssi: -50, profile: prof(20) }],
    ["mesh-1>mesh-2", { ts: 1000, motion: 20, rssi: -40, profile: prof(30) }],
    ["mesh-3>mesh-1", { ts: 0, motion: 99, rssi: -60, profile: prof(5) }], // stale at t=6000
  ]);
  const row = buildFeatures(latest, 6000, 5500);
  assert.equal(row.length, FEATURE_NAMES.length);
  assert.equal(row[FEATURE_NAMES.indexOf("p1-2_motion")], 15);
  assert.equal(row[FEATURE_NAMES.indexOf("p1-2_rssi")], -45);
  assert.equal(row[FEATURE_NAMES.indexOf("p1-2_prof0")], 25);
  assert.equal(row[FEATURE_NAMES.indexOf("p1-3_motion")], MISSING);
  assert.equal(row[FEATURE_NAMES.indexOf("links_present")], 1);

  const empty = buildFeatures(new Map(), 0);
  assert.equal(empty[FEATURE_NAMES.indexOf("links_present")], 0);
  assert.equal(empty[FEATURE_NAMES.indexOf("motion_mean")], MISSING);
});

// A one-tree model: motion_mean <= 20 -> "0" people, otherwise "3".
function tinyModel() {
  const f = FEATURE_NAMES.indexOf("motion_mean");
  const leafA = CLASSES.map((c) => (c === "0" ? 1 : 0));
  const leafB = CLASSES.map((c) => (c === "3" ? 1 : 0));
  return {
    type: "random_forest", classes: CLASSES, featureNames: FEATURE_NAMES,
    trees: [{ f: [f, -2, -2], t: [20, -2, -2], l: [1, -1, -1], r: [2, -1, -1], v: [null, leafA, leafB] }],
    meta: { trainedAt: "2026-10-28T00:00:00Z", testAccuracy: 0.8, withinOneAccuracy: 0.95, trainRows: 100 },
  };
}

test("model validation and prediction", () => {
  assert.equal(validateModel(tinyModel()), null);
  assert.match(validateModel({ ...tinyModel(), featureNames: ["x"] }), /don't match/);
  assert.match(validateModel({ ...tinyModel(), trees: [{ f: [0], t: [1], l: [5], r: [5], v: [null] }] }), /structure/);
  const row = new Array(FEATURE_NAMES.length).fill(0);
  row[FEATURE_NAMES.indexOf("motion_mean")] = 50;
  const p = predictProba(tinyModel(), row);
  assert.equal(p[CLASSES.indexOf("3")], 1);
});

function tmpModelFile(model) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-mesh-"));
  const file = path.join(dir, "mesh-count.json");
  if (model) fs.writeFileSync(file, JSON.stringify(model));
  return { dir, file };
}

test("hardware mode: no model = no count; with a model it predicts from real links", () => {
  let t = 100000;
  const noModel = createMeshEngine({ mode: "hardware", now: () => t, dataFile: null, modelPath: null });
  noModel.ingest("mesh-1", [link("mesh-2", 50), link("mesh-3", 50)]);
  noModel.tick();
  assert.equal(noModel.status().prediction, null);
  assert.equal(noModel.status().model.loaded, false);

  const { dir, file } = tmpModelFile(tinyModel());
  const eng = createMeshEngine({ mode: "hardware", now: () => t, dataFile: null, modelPath: file });
  eng.ingest("mesh-1", [link("mesh-2", 50), link("mesh-3", 50)]);
  eng.tick();
  const st = eng.status();
  assert.equal(st.prediction.label, "3");
  assert.equal(st.prediction.source, "model");
  assert.equal(st.model.testAccuracy, 0.8);
  assert.equal(st.nodes["mesh-1"].online, true);
  assert.equal(st.nodes["mesh-4"].online, false);

  // Links go stale -> fewer than minLinks pairs -> no prediction.
  t += 60000;
  eng.tick();
  assert.equal(eng.status().prediction, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("labelled recording, CSV export and clear", () => {
  let t = 1_700_000_000_000;
  const { dir } = tmpModelFile(null);
  const dataFile = path.join(dir, "rec.jsonl");
  const eng = createMeshEngine({ mode: "hardware", now: () => t, dataFile, modelPath: null });
  assert.equal(eng.startRecording("7").ok, false);
  assert.equal(eng.startRecording("2").ok, true);
  for (let i = 0; i < 3; i++) { eng.ingest("mesh-1", [link("mesh-2", 30)]); eng.tick(); t += 2000; }
  eng.stopRecording();
  eng.tick();
  const st = eng.status();
  assert.equal(st.recording.rowsByLabel["2"], 3);
  assert.equal(st.recording.sessions, 1);
  const csv = eng.exportCsv().trim().split("\n");
  assert.equal(csv.length, 4);
  assert.equal(csv[0].split(",").length, FEATURE_NAMES.length + 4);
  assert.equal(csv[1].split(",")[2], "2");

  // Recordings survive a restart (read back from the file).
  const again = createMeshEngine({ mode: "hardware", now: () => t, dataFile, modelPath: null });
  assert.equal(again.status().recording.totalRows, 3);
  again.clear();
  assert.equal(again.status().recording.totalRows, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("simulation mode tags its count as simulation", () => {
  const eng = createMeshEngine({ mode: "simulation", dataFile: null, modelPath: null });
  eng.tick();
  const st = eng.status();
  assert.equal(st.mode, "simulation");
  assert.equal(st.prediction.source, "simulation");
  assert.ok(CLASSES.includes(st.prediction.label));
});

test("routes: device key for posts, admin key for controls", async () => {
  const eng = createMeshEngine({ mode: "simulation", dataFile: null, modelPath: null });
  const app = express();
  app.use(express.json());
  app.use("/api", buildMeshRouter(eng));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = (p, body, headers = {}) => fetch(base + p, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  try {
    const body = { nodeId: "mesh-1", links: [link("mesh-2")] };
    assert.equal((await post("/csi/mesh", body)).status, 401);
    assert.equal((await post("/csi/mesh", body, { "X-Device-Key": "dev-key-xyz" })).status, 409); // simulation
    assert.equal((await post("/csi/mesh/mode", { mode: "hardware" })).status, 401);
    assert.equal((await post("/csi/mesh/mode", { mode: "hardware" }, { "X-Admin-Key": "admin-key-xyz" })).status, 200);
    assert.equal((await post("/csi/mesh", body, { "X-Device-Key": "dev-key-xyz" })).status, 200);
    assert.equal((await post("/csi/mesh", { nodeId: "mesh-1", links: [link("mesh-1")] }, { "X-Device-Key": "dev-key-xyz" })).status, 400);
    assert.equal((await post("/csi/mesh/record", { label: "1" })).status, 401);
    assert.equal((await post("/csi/mesh/record", { label: "1" }, { "X-Admin-Key": "admin-key-xyz" })).status, 200);
    assert.equal((await fetch(base + "/csi/mesh/export")).status, 401);
    const exp = await fetch(base + "/csi/mesh/export", { headers: { "X-Admin-Key": "admin-key-xyz" } });
    assert.equal(exp.status, 200);
    assert.match(await exp.text(), /^t,session,label,source,/);
    const st = await (await fetch(base + "/csi/mesh/status")).json();
    assert.equal(st.mode, "hardware");
    assert.equal(st.recording.active, true);
    assert.ok(!JSON.stringify(st).includes("key-xyz"));
  } finally {
    server.close();
  }
});
