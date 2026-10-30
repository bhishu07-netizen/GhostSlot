// Room check-in API: sign-in required, counts only (no names), one room per
// person, input validation, check-out, expiry and facilities not allowed.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

process.env.SUPABASE_URL = ""; // memory only in tests
const { buildCheckins } = await import("../checkin.js");

const USERS = {
  amy: { id: "u-amy", name: "Amy", role: "student" },
  bob: { id: "u-bob", name: "Bob", role: "student" },
  fac: { id: "u-fac", name: "Staff", role: "facilities" },
};
const requireAuth = (req, res, next) => {
  const u = USERS[req.get("x-test-user")];
  if (!u) return res.status(401).json({ error: "not_signed_in" });
  req.user = u;
  next();
};
const sameOriginOnly = (_req, _res, next) => next();

async function withServer(fn, now = () => Date.now()) {
  const app = express();
  app.use(express.json());
  app.use("/api", buildCheckins({ requireAuth, sameOriginOnly, now }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, { method = "GET", body, user } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
  };
  try { await fn(call); } finally { server.close(); }
}

test("sign-in is required", async () => {
  await withServer(async (call) => {
    assert.equal((await call("/checkins")).status, 401);
    assert.equal((await call("/checkins", { method: "POST", body: { roomId: "A2-104" } })).status, 401);
  });
});

test("check in, see counts only, move rooms, check out", async () => {
  await withServer(async (call) => {
    let r = await call("/checkins", { method: "POST", user: "amy", body: { roomId: "A2-104", minutes: 30, method: "qr" } });
    assert.equal(r.status, 201);
    assert.equal(r.data.mine.roomId, "A2-104");
    assert.equal(r.data.mine.method, "qr");

    r = await call("/checkins", { method: "POST", user: "bob", body: { roomId: "A2-104" } });
    assert.equal(r.data.counts["A2-104"], 2);

    // Bob sees counts, never who is checked in.
    r = await call("/checkins", { user: "bob" });
    assert.equal(r.data.counts["A2-104"], 2);
    assert.ok(!JSON.stringify(r.data).includes("Amy") && !JSON.stringify(r.data).includes("u-amy"));

    // One room at a time: Amy moving replaces her old check-in.
    r = await call("/checkins", { method: "POST", user: "amy", body: { roomId: "CSE-Lab-9", method: "tap" } });
    assert.deepEqual(r.data.counts, { "A2-104": 1, "CSE-Lab-9": 1 });

    r = await call("/checkins/me", { method: "DELETE", user: "amy" });
    assert.equal(r.data.mine, null);
    assert.deepEqual(r.data.counts, { "A2-104": 1 });
  });
});

test("bad input is rejected and facilities can't check in", async () => {
  await withServer(async (call) => {
    const post = (body, user = "amy") => call("/checkins", { method: "POST", user, body });
    assert.equal((await post({ roomId: "Moon-Base" })).data.error, "unknown_room");
    assert.equal((await post({ roomId: "A2-104", minutes: 5 })).data.error, "bad_minutes");
    assert.equal((await post({ roomId: "A2-104", minutes: 999 })).data.error, "bad_minutes");
    assert.equal((await post({ roomId: "A2-104", minutes: 30.5 })).data.error, "bad_minutes");
    assert.equal((await post({ roomId: "A2-104", method: "gps" })).data.error, "bad_method");
    assert.equal((await post({ roomId: "A2-104" }, "fac")).status, 403);
  });
});

test("check-ins expire on their own", async () => {
  let t = 1_700_000_000_000;
  await withServer(async (call) => {
    await call("/checkins", { method: "POST", user: "amy", body: { roomId: "A2-104", minutes: 15 } });
    assert.equal((await call("/checkins", { user: "amy" })).data.counts["A2-104"], 1);
    t += 16 * 60 * 1000;
    const r = await call("/checkins", { user: "amy" });
    assert.equal(r.data.mine, null);
    assert.deepEqual(r.data.counts, {});
  }, () => t);
});
