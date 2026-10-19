// Campus Twin API with a fake Supabase client: auth is required, results are
// aggregated correctly, inputs are validated and the data is labelled simulated.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { buildTwin } from "../twin.js";

const NOW = "2026-10-19T09:00:00+00:00";
const data = {
  gs_twin_rooms: [
    { id: "A1-105", name: "A1 · 105", block: "A1 Block", kind: "classroom", capacity: 70, rated_kw: 3.6 },
    { id: "CSE-Lab-4", name: "CSE Block · Lab 4", block: "CSE Block", kind: "lab", capacity: 40, rated_kw: 9 },
  ],
  gs_twin_buildings: [{ id: "A1", name: "A1 Block" }],
  gs_twin_alert_acks: [],
  gs_twin_water: [{ ts: NOW, litres: 400 }],
  gs_twin_readings: [],
};
const rpcs = {
  gs_twin_generate: 0,
  gs_twin_now: [
    { room_id: "A1-105", ts: NOW, occupants: 0, power_kw: 2.5, state: "wasting" },
    { room_id: "CSE-Lab-4", ts: NOW, occupants: 30, power_kw: 7.1, state: "occupied" },
  ],
  gs_twin_energy: [
    { room_id: "A1-105", total_kwh: 70, wasted_kwh: 40, waste_hours: 16, occupied_util_pct: 13.8 },
    { room_id: "CSE-Lab-4", total_kwh: 390, wasted_kwh: 110, waste_hours: 17.5, occupied_util_pct: 83.8 },
  ],
  gs_twin_energy_daily: [{ day: "2026-10-18", total_kwh: 37.3, wasted_kwh: 6.7 }],
  gs_twin_heatmap: [{ room_id: "A1-105", hour: 10, util_pct: 20 }],
  gs_twin_water_anomalies: [
    { building_id: "A1", ts: "2026-10-18T20:00:00+00:00", litres: 300, baseline: 25, z: 60 },
    { building_id: "A1", ts: "2026-10-18T20:15:00+00:00", litres: 310, baseline: 25, z: 62 },
    { building_id: "A1", ts: "2026-10-18T23:00:00+00:00", litres: 200, baseline: 25, z: 30 },
  ],
};
const upserts = [];
const fakeClient = {
  rpc: async (fn) => ({ data: rpcs[fn], error: null }),
  from: (name) => {
    const q = {
      select: () => q, order: () => q, eq: () => q, gte: () => q, limit: () => q,
      then: (ok) => ok({ data: data[name], error: null }),
      upsert: async (row) => { upserts.push(row); return { error: null }; },
    };
    return q;
  },
};

let server, base;
before(async () => {
  const app = express();
  app.use(express.json());
  const requireAuth = (req, res, next) => {
    const who = req.get("x-test-user");
    if (!who) return res.status(401).json({ error: "not_signed_in" });
    req.user = who === "student" ? { id: "u2", roll_lower: "24bcs99999", role: "student" }
      : who === "faculty" ? { id: "u3", roll_lower: "e21045", role: "faculty" }
      : { id: "u1", roll_lower: "fms2041", role: "facilities" };
    next();
  };
  const sameOriginOnly = (_req, _res, next) => next();
  app.use("/api", buildTwin({ requireAuth, sameOriginOnly, client: fakeClient, autoTick: false }));
  app.use((err, _req, res, _next) => res.status(500).json({ error: String(err.message) }));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server?.close());

const get = (p, auth = true) => fetch(base + p, { headers: auth ? { "x-test-user": "1" } : {} });

test("twin endpoints require sign-in", async () => {
  assert.equal((await get("/twin/overview", false)).status, 401);
  assert.equal((await get("/twin/water?building=A1", false)).status, 401);
});

test("overview aggregates energy, water episodes, alerts and suggestions", async () => {
  const res = await get("/twin/overview?days=7");
  assert.equal(res.status, 200);
  const o = await res.json();
  assert.equal(o.dataSource, "simulated");
  assert.equal(o.energy.totalKwh, 460);
  assert.equal(o.energy.wastedKwh, 150);
  assert.equal(o.energy.wastedInr, 150 * o.tariffInrPerKwh);
  assert.equal(o.energy.rooms[0].roomId, "CSE-Lab-4"); // sorted by waste
  // Two back-to-back readings form one episode; the 23:00 one is separate.
  assert.equal(o.water.episodes.length, 2);
  const first = o.water.episodes.find((e) => e.start === "2026-10-18T20:00:00+00:00");
  assert.equal(first.readings, 2);
  assert.equal(first.excessLitres, 275 + 285);
  // One room wasting now + two water episodes.
  assert.equal(o.alerts.filter((a) => a.kind === "energy_waste").length, 1);
  assert.equal(o.alerts.filter((a) => a.kind === "water_anomaly").length, 2);
  assert.ok(o.alerts.every((a) => a.status === "open"));
  // Only the room under 30% class-hour use gets a reallocation suggestion.
  assert.deepEqual(o.suggestions.map((s) => s.roomId), ["A1-105"]);
});

test("water series validates the building id", async () => {
  assert.equal((await get("/twin/water?building=../etc")).status, 400);
  const ok = await (await get("/twin/water?building=A1")).json();
  assert.equal(ok.readings.length, 1);
});

test("only facilities staff can log readings, with validated values", async () => {
  const post = (who, body) => fetch(base + "/twin/readings", { method: "POST", headers: { "Content-Type": "application/json", "x-test-user": who }, body: JSON.stringify(body) });
  assert.equal((await post("student", { kind: "water", buildingId: "A1", litres: 120 })).status, 403);
  assert.equal((await post("faculty", { kind: "water", buildingId: "A1", litres: 120 })).status, 403);
  assert.equal((await post("facilities", { kind: "water", buildingId: "A1", litres: -5 })).status, 400);
  assert.equal((await post("facilities", { kind: "energy", roomId: "A1-105", powerKw: 999, occupants: 3 })).status, 400);
  assert.equal((await post("facilities", { kind: "energy", roomId: "A1-105", powerKw: 2.4, occupants: 1.5 })).status, 400);
  assert.equal((await post("facilities", { kind: "gas", buildingId: "A1" })).status, 400);
  const ok = await post("facilities", { kind: "water", buildingId: "A1", litres: 120 });
  assert.equal(ok.status, 201);
  const row = upserts.at(-1);
  assert.equal(row.source, "manual");
  assert.equal(row.logged_by, "u1");
  assert.equal(new Date(row.ts).getTime() % (15 * 60 * 1000), 0); // snapped to a 15-min slot
  assert.equal((await post("facilities", { kind: "energy", roomId: "A1-105", powerKw: 2.4, occupants: 12 })).status, 201);
});

test("only facilities accounts can update alerts", async () => {
  const res = await fetch(base + "/twin/alerts/ack", { method: "POST", headers: { "Content-Type": "application/json", "x-test-user": "student" }, body: JSON.stringify({ key: "water:A1:2026-10-18T20:00:00+00:00", status: "resolved" }) });
  assert.equal(res.status, 403);
  const student = await (await fetch(base + "/twin/overview", { headers: { "x-test-user": "student" } })).json();
  assert.equal(student.canManageAlerts, false);
  const faculty = await (await fetch(base + "/twin/overview", { headers: { "x-test-user": "faculty" } })).json();
  assert.equal(faculty.canManageAlerts, false);
  const admin = await (await get("/twin/overview")).json();
  assert.equal(admin.canManageAlerts, true);
});

test("alert ack validates key and status, then stores it", async () => {
  const post = (body) => fetch(base + "/twin/alerts/ack", { method: "POST", headers: { "Content-Type": "application/json", "x-test-user": "1" }, body: JSON.stringify(body) });
  assert.equal((await post({ key: "drop table", status: "resolved" })).status, 400);
  assert.equal((await post({ key: "water:A1:2026-10-18T20:00:00+00:00", status: "deleted" })).status, 400);
  const res = await post({ key: "water:A1:2026-10-18T20:00:00+00:00", status: "resolved" });
  assert.equal(res.status, 200);
  assert.equal(upserts.at(-1).user_id, "u1");
  assert.equal(upserts.at(-1).status, "resolved");
});

test("without Supabase configured the twin says so instead of failing", async () => {
  const app = express();
  const requireAuth = (req, _res, next) => ((req.user = { id: "u1", role: "facilities" }), next());
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  app.use("/api", buildTwin({ requireAuth, sameOriginOnly: (_q, _s, n) => n(), autoTick: false }));
  const s = await new Promise((r) => { const x = app.listen(0, () => r(x)); });
  const res = await fetch(`http://127.0.0.1:${s.address().port}/api/twin/overview`);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, "twin_not_configured");
  s.close();
});
