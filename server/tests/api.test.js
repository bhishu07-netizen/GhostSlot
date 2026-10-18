// End-to-end: boots the real server on a spare port with a throw-away data
// folder and walks through signup, the age gate, login and the attack cases.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "index.js");
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = "http://localhost:5173";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-test-"));
let proc;

before(async () => {
  proc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, GEMINI_API_KEY: "", CSI_DEVICE_KEY: "dev-key-123", CSI_ADMIN_KEY: "", NODE_ENV: "test", SERVE_STATIC: "off" },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("server did not start");
});
after(() => { proc?.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

function client() {
  let cookie = "";
  return async (p, { method = "GET", body, origin = ORIGIN, headers = {} } = {}) => {
    const res = await fetch(BASE + p, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const kv = c.split(";")[0];
      const name = kv.split("=")[0];
      cookie = [...cookie.split("; ").filter((x) => x && !x.startsWith(name + "=")), kv].join("; ");
    }
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data, headers: res.headers };
  };
}

test("under-18 is refused and the browser is locked from retrying", async () => {
  const c = client();
  const r1 = await c("/api/auth/age-check", { method: "POST", body: { dob: "2012-06-01" } });
  assert.equal(r1.status, 403); assert.equal(r1.data.error, "under_age");
  const r2 = await c("/api/auth/age-check", { method: "POST", body: { dob: "1999-06-01" } });
  assert.equal(r2.status, 403); assert.equal(r2.data.error, "age_gate_locked");
  const cfg = await c("/api/auth/config");
  assert.equal(cfg.data.ageGate.locked, true);
});

test("signup needs a valid, unused age token; DOB is never stored", async () => {
  const c = client();
  const noTok = await c("/api/auth/signup", { method: "POST", body: { name: "Riya Sharma", roll: "24BCS11111", password: "Str0ng-pass-99", consent: true } });
  assert.equal(noTok.status, 403);
  const forged = await c("/api/auth/signup", { method: "POST", body: { name: "Riya Sharma", roll: "24BCS11111", password: "Str0ng-pass-99", consent: true, ageToken: "eyJraW5kIjoiYWdlIn0.fake" } });
  assert.equal(forged.status, 403);

  const age = await c("/api/auth/age-check", { method: "POST", body: { dob: "2005-03-14" } });
  assert.equal(age.status, 200);
  const noConsent = await c("/api/auth/signup", { method: "POST", body: { name: "Riya Sharma", roll: "24BCS11111", password: "Str0ng-pass-99", ageToken: age.data.ageToken } });
  assert.equal(noConsent.status, 400);
  const ok = await c("/api/auth/signup", { method: "POST", body: { name: "Riya Sharma", roll: "24BCS11111", password: "Str0ng-pass-99", consent: true, ageToken: age.data.ageToken } });
  assert.equal(ok.status, 201); assert.equal(ok.data.user.ageVerified, true);
  const reuse = await client()("/api/auth/signup", { method: "POST", body: { name: "Kabir Singh", roll: "24BCS22222", password: "Str0ng-pass-99", consent: true, ageToken: age.data.ageToken } });
  assert.equal(reuse.status, 403);

  const raw = fs.readFileSync(path.join(dataDir, "ghostslot-db.json"), "utf8");
  assert.ok(!raw.includes("2005-03-14") && !raw.includes("Str0ng-pass-99"));
  assert.equal((await c("/api/auth/me")).data.user.roll, "24BCS11111");
});

test("login: same answer for unknown user and wrong password; per-account lockout", async () => {
  const c = client();
  const a = await c("/api/auth/login", { method: "POST", body: { roll: "99ZZZ00000", password: "whatever1" } });
  const b = await c("/api/auth/login", { method: "POST", body: { roll: "23BCS10432", password: "wrong-pass1" } });
  assert.equal(a.status, 401); assert.equal(b.status, 401); assert.equal(a.data.message, b.data.message);
  let last;
  for (let i = 0; i < 6; i++) last = await c("/api/auth/login", { method: "POST", body: { roll: "24BCS11111", password: "nope-nope-1" } });
  assert.equal(last.status, 429);
});

test("CSRF: cross-site or origin-less POSTs are blocked", async () => {
  const c = client();
  assert.equal((await c("/api/auth/login", { method: "POST", body: { roll: "x", password: "y" }, origin: "https://evil.example" })).status, 403);
  assert.equal((await c("/api/auth/login", { method: "POST", body: { roll: "x", password: "y" }, origin: null })).status, 403);
});

test("AI endpoints need a session; logout and delete-account work", async () => {
  const c = client();
  assert.equal((await c("/api/ai/chat", { method: "POST", body: { message: "hi" } })).status, 401);
  const login = await c("/api/auth/login", { method: "POST", body: { roll: "23BCS10432", password: "Ghost-Demo-2026" } });
  assert.equal(login.status, 200);
  assert.equal((await c("/api/ai/chat", { method: "POST", body: { message: "hi" } })).status, 503); // signed in, no key in test
  await c("/api/auth/logout", { method: "POST" });
  assert.equal((await c("/api/auth/me")).status, 401);

  const d = client();
  const age = await d("/api/auth/age-check", { method: "POST", body: { dob: "2001-01-01" } });
  await d("/api/auth/signup", { method: "POST", body: { name: "Kabir Singh", roll: "24BCS99999", password: "Temp-pass-2026", consent: true, ageToken: age.data.ageToken } });
  assert.equal((await d("/api/auth/delete-account", { method: "POST", body: { password: "wrong" } })).status, 401);
  assert.equal((await d("/api/auth/delete-account", { method: "POST", body: { password: "Temp-pass-2026" } })).status, 200);
  const again = await client()("/api/auth/login", { method: "POST", body: { roll: "24BCS99999", password: "Temp-pass-2026" } });
  assert.equal(again.status, 401);
});

test("Wi-Fi CSI: device key required, admin endpoints off without a key", async () => {
  const c = client();
  assert.equal((await c("/api/csi/demo-room", { method: "POST", body: { nodeId: "node-a", value: 50 }, origin: null })).status, 401);
  const ok = await c("/api/csi/demo-room", { method: "POST", body: { nodeId: "node-a", value: 50 }, origin: null, headers: { "X-Device-Key": "dev-key-123" } });
  assert.equal(ok.status, 409); // key accepted; server is in simulation mode
  assert.equal((await c("/api/csi/mode", { method: "POST", body: { mode: "hardware" }, origin: null })).status, 403);
});

test("security headers are present", async () => {
  const r = await client()("/api/health");
  assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-powered-by"), null);
  assert.equal(r.headers.get("cache-control"), "no-store");
});
