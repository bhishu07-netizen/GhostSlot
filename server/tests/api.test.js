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
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, GEMINI_API_KEY: "", FACILITIES_ACCESS_CODE: "estate-code-77", CSI_DEVICE_KEY: "dev-key-123", CSI_ADMIN_KEY: "", NODE_ENV: "test", SERVE_STATIC: "off" },
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

test("under-18 staff sign-up is refused and the browser is locked from retrying", async () => {
  const c = client();
  const r1 = await c("/api/auth/age-check", { method: "POST", body: { dob: "2012-06-01", role: "facilities" } });
  assert.equal(r1.status, 403); assert.equal(r1.data.error, "under_age");
  const r2 = await c("/api/auth/age-check", { method: "POST", body: { dob: "1999-06-01", role: "facilities" } });
  assert.equal(r2.status, 403); assert.equal(r2.data.error, "age_gate_locked");
  // Under 10 isn't a college student either.
  const r3 = await client()("/api/auth/age-check", { method: "POST", body: { dob: `${new Date().getFullYear() - 8}-01-01`, role: "student" } });
  assert.equal(r3.status, 403);
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
  // The shared demo account can't be deleted or sign every judge out.
  assert.equal((await c("/api/auth/delete-account", { method: "POST", body: { password: "Ghost-Demo-2026" } })).status, 403);
  assert.equal((await c("/api/auth/logout-all", { method: "POST" })).status, 403);
  assert.equal((await c("/api/auth/me")).data.user.isDemo, true);
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

test("roles: separate demo accounts, role-matched login, facilities sign-up needs the code", async () => {
  const cfg = await client()("/api/auth/config");
  assert.deepEqual(Object.keys(cfg.data.demos).sort(), ["facilities", "faculty", "student"]);
  assert.equal(cfg.data.facilitiesSignupOpen, true);

  const f = client();
  const fac = await f("/api/auth/login", { method: "POST", body: { role: "facilities", roll: cfg.data.demos.facilities.roll, password: "Ghost-Demo-2026" } });
  assert.equal(fac.status, 200);
  assert.equal(fac.data.user.role, "facilities");
  assert.equal(fac.data.user.canManageTwin, true);
  const fy = await client()("/api/auth/login", { method: "POST", body: { role: "faculty", roll: cfg.data.demos.faculty.roll, password: "Ghost-Demo-2026" } });
  assert.equal(fy.data.user.role, "faculty");
  assert.equal(fy.data.user.canManageTwin, false);
  // Right ID and password, wrong role picked → refused with the generic message.
  const wrong = await client()("/api/auth/login", { method: "POST", body: { role: "student", roll: cfg.data.demos.facilities.roll, password: "Ghost-Demo-2026" } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.error, "invalid_credentials");

  const s = client();
  const age = async () => (await s("/api/auth/age-check", { method: "POST", body: { dob: "1990-05-05" } })).data.ageToken;
  const base = { name: "Sunita Devi", roll: "FMS3301", password: "Pipe-fixer-88", consent: true };
  assert.equal((await s("/api/auth/signup", { method: "POST", body: { ...base, role: "facilities", department: "Plumbing", ageToken: await age() } })).status, 403);
  assert.equal((await s("/api/auth/signup", { method: "POST", body: { ...base, role: "facilities", department: "Plumbing", accessCode: "guess", ageToken: await age() } })).status, 403);
  assert.equal((await s("/api/auth/signup", { method: "POST", body: { ...base, role: "facilities", department: "Rocket science", accessCode: "estate-code-77", ageToken: await age() } })).status, 400);
  assert.equal((await s("/api/auth/signup", { method: "POST", body: { ...base, role: "admin", ageToken: await age() } })).status, 400);
  const made = await s("/api/auth/signup", { method: "POST", body: { ...base, role: "facilities", department: "Plumbing", accessCode: "estate-code-77", ageToken: await age() } });
  assert.equal(made.status, 201);
  assert.equal(made.data.user.role, "facilities");
  assert.equal(made.data.user.department, "Plumbing");

  // Faculty sign-up needs a department but no code.
  const t = client();
  const tok = (await t("/api/auth/age-check", { method: "POST", body: { dob: "1985-02-02" } })).data.ageToken;
  const fs = await t("/api/auth/signup", { method: "POST", body: { name: "Anil Rao", roll: "E30412", password: "Lecture-hall-9", consent: true, role: "faculty", department: "ECE", ageToken: tok } });
  assert.equal(fs.status, 201);
  assert.equal(fs.data.user.role, "faculty");
});

test("under-18 students join only after a parent/guardian approves; staff stay 18+", async () => {
  const kid = client();
  const y = new Date().getFullYear();
  const dob = `${y - 16}-01-01`;
  // Faculty / facilities under 18 are still blocked (and locked out for 24 h).
  const staff = client();
  assert.equal((await staff("/api/auth/age-check", { method: "POST", body: { dob, role: "faculty" } })).status, 403);

  const ac = await kid("/api/auth/age-check", { method: "POST", body: { dob, role: "student" } });
  assert.equal(ac.status, 200);
  assert.equal(ac.data.minor, true);
  // A minor token can't be used to make a staff account.
  assert.equal((await kid("/api/auth/signup", { method: "POST", body: { role: "faculty", department: "CSE", name: "Riya Mehta", roll: "E99881", password: "Lab-coat-2026", consent: true, ageToken: ac.data.ageToken } })).status, 403);
  const ac2 = await kid("/api/auth/age-check", { method: "POST", body: { dob, role: "student" } });
  const su = await kid("/api/auth/signup", { method: "POST", body: { role: "student", name: "Riya Mehta", roll: "25BCS20001", password: "Lab-coat-2026", consent: true, ageToken: ac2.data.ageToken } });
  assert.equal(su.status, 202);
  assert.equal(su.data.pending, true);
  const code = su.data.guardianPath.split("#")[1];
  // No account (and no session) until the guardian approves.
  assert.equal((await client()("/api/auth/login", { method: "POST", body: { role: "student", roll: "25BCS20001", password: "Lab-coat-2026" } })).status, 401);

  const g = client();
  const look = await g("/api/auth/guardian/lookup", { method: "POST", body: { code } });
  assert.equal(look.data.status, "pending");
  assert.equal(look.data.child.name, "Riya Mehta");
  assert.equal((await g("/api/auth/guardian/lookup", { method: "POST", body: { code: "x".repeat(43) } })).status, 404);
  const approve = (body) => g("/api/auth/guardian/approve", { method: "POST", body: { code, relation: "Parent", consent: true, guardianName: "Sanjay Mehta", dob: "1978-03-03", ...body } });
  assert.equal((await approve({ dob: `${y - 15}-01-01` })).status, 403);   // guardian must be an adult
  assert.equal((await approve({ guardianName: "Riya Mehta" })).status, 400); // student can't approve as themself
  assert.equal((await approve({ relation: "Friend" })).status, 400);
  assert.equal((await approve({ consent: false })).status, 400);
  assert.equal((await approve({})).status, 200);
  assert.equal((await g("/api/auth/guardian/lookup", { method: "POST", body: { code } })).data.status, "approved");

  const me = client();
  const li = await me("/api/auth/login", { method: "POST", body: { role: "student", roll: "25BCS20001", password: "Lab-coat-2026" } });
  assert.equal(li.status, 200);
  assert.equal(li.data.user.isMinor, true);
  assert.equal(li.data.user.guardian.relation, "Parent");

  // Guardian withdraws consent → account gone.
  assert.equal((await g("/api/auth/guardian/withdraw", { method: "POST", body: { code, confirm: true } })).data.deleted, "account");
  assert.equal((await client()("/api/auth/login", { method: "POST", body: { role: "student", roll: "25BCS20001", password: "Lab-coat-2026" } })).status, 401);
});

test("Wi-Fi CSI: device key required, admin endpoints off without a key", async () => {
  const c = client();
  assert.equal((await c("/api/csi/demo-room", { method: "POST", body: { nodeId: "node-a", value: 50 }, origin: null })).status, 401);
  const ok = await c("/api/csi/demo-room", { method: "POST", body: { nodeId: "node-a", value: 50 }, origin: null, headers: { "X-Device-Key": "dev-key-123" } });
  assert.equal(ok.status, 409); // key accepted; server is in simulation mode
  // Heartbeat marks the board seen without feeding a reading.
  assert.equal((await c("/api/csi/demo-room", { method: "POST", body: { nodeId: "node-a", heartbeat: true }, origin: null })).status, 401);
  const hb = await c("/api/csi/demo-room", { method: "POST", body: { nodeId: "node-a", heartbeat: true }, origin: null, headers: { "X-Device-Key": "dev-key-123" } });
  assert.equal(hb.status, 200);
  assert.ok(hb.data.status.devices["node-a"].lastSeen);
  assert.equal((await c("/api/csi/demo-room", { method: "POST", body: { nodeId: "oled", heartbeat: true }, origin: null, headers: { "X-Device-Key": "dev-key-123" } })).status, 400);
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
