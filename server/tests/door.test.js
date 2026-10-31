// IR door counter API: device key on writes, counts, duplicates, offline, reset.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

process.env.CSI_DEVICE_KEY = "dev-key-door";
process.env.CSI_ADMIN_KEY = "admin-key-door";
const { createDoorCounter, buildDoorRouter } = await import("../door.js");
const { requireDeviceKey, requireAdminKey } = await import("../csi.js");

async function withServer(fn, now = () => Date.now()) {
  const app = express(); app.use(express.json());
  app.use("/api", buildDoorRouter(createDoorCounter({ now }), { requireDeviceKey, requireAdminKey }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, { method = "GET", body, key, admin } = {}) => {
    const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(key ? { "x-device-key": key } : {}), ...(admin ? { "x-admin-key": admin } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json() };
  };
  try { await fn(call); } finally { server.close(); }
}

test("writes need the device key; status is public", async () => {
  await withServer(async (call) => {
    assert.equal((await call("/door/event", { method: "POST", body: { event: "in" } })).status, 401);
    assert.equal((await call("/door/event", { method: "POST", body: { event: "in" }, key: "wrong" })).status, 401);
    assert.equal((await call("/door/status")).status, 200);
  });
});

test("entries and exits give the count; a retried event counts once; bad input rejected", async () => {
  await withServer(async (call) => {
    const ev = (event, id) => call("/door/event", { method: "POST", body: { event, id }, key: "dev-key-door" });
    await ev("in", "e1"); await ev("in", "e2"); await ev("in", "e2"); await ev("out", "e3");
    const st = (await call("/door/status")).data;
    assert.equal(st.entries, 2); assert.equal(st.exits, 1); assert.equal(st.inside, 1);
    assert.equal((await ev("sideways", "e4")).status, 400);
    await ev("out", "e5"); await ev("out", "e6");
    assert.equal((await call("/door/status")).data.inside, 0); // never below zero
  });
});

test("heartbeat shows live beams and goes offline after silence; admin reset", async () => {
  let t = 1_700_000_000_000;
  await withServer(async (call) => {
    assert.equal((await call("/door/heartbeat", { method: "POST", body: { a: "yes", b: false }, key: "dev-key-door" })).status, 400);
    await call("/door/heartbeat", { method: "POST", body: { a: true, b: false }, key: "dev-key-door" });
    let st = (await call("/door/status")).data;
    assert.equal(st.online, true); assert.deepEqual(st.beams, { a: true, b: false });
    t += 10_000;
    st = (await call("/door/status")).data;
    assert.equal(st.online, false); assert.deepEqual(st.beams, { a: false, b: false });
    assert.equal((await call("/door/reset", { method: "POST", body: { inside: 3 } })).status, 401);
    const r = await call("/door/reset", { method: "POST", body: { inside: 3 }, admin: "admin-key-door" });
    assert.equal(r.data.status.inside, 3);
  }, () => t);
});
