// Accounts, sessions and the signup age gate.
//
// Age gate (the headline privacy feature):
//   1. Neutral age screen — the app asks for a date of birth without saying
//      what the cut-off is, and no birth year is pre-selected.
//   2. The SERVER decides. POST /age-check computes the exact age (IST
//      calendar) and, only if 18+, returns a short-lived signed "ageToken".
//      Signup refuses to create an account without a valid, unused token, so
//      the check can't be skipped by calling the API directly.
//   3. Data minimisation — the date of birth is used once and discarded.
//      We store only `age_verified_adult = true` and when it was checked.
//   4. Under 18 → no account, and a signed, httpOnly lock cookie stops an
//      immediate retry with a different date for 24 hours.
//   Why 18: under India's DPDP Act 2023 anyone under 18 is a "child", and
//   their data needs verifiable parental consent, which GhostSlot does not
//   collect. So GhostSlot only creates accounts for adults.
import express from "express";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import {
  IS_PROD, MIN_AGE, ageOn, parseDob, hashPassword, verifyPassword, dummyHash, newToken, sha256,
  signPayload, verifyPayload, ROLL_RE, NAME_RE, passwordProblem, cleanText,
} from "./security.js";
import { DuplicateError } from "./store.js";

const SESSION_COOKIE = IS_PROD ? "__Host-gs_session" : "gs_session";
const AGE_LOCK_COOKIE = IS_PROD ? "__Host-gs_agegate" : "gs_agegate";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const AGE_TOKEN_TTL_MS = 20 * 60 * 1000;
const AGE_LOCK_MS = 24 * 3600 * 1000;

const baseCookie = { httpOnly: true, secure: IS_PROD, sameSite: "strict", path: "/" };

// Age tokens are single-use: remember spent nonces until they expire.
const spentAgeNonces = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [n, exp] of spentAgeNonces) if (exp < now) spentAgeNonces.delete(n);
}, 60 * 1000).unref();

function json429(message) {
  return (_req, res) => res.status(429).json({ error: "rate_limited", message });
}

export function publicUser(u, extra = {}) {
  return {
    id: u.id,
    roll: u.roll,
    name: u.name,
    ageVerified: !!u.age_verified_adult,
    ageCheckedAt: u.age_checked_at,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
    isDemo: isDemoUser(u),
    ...extra,
  };
}

function ageLockInfo(req) {
  const p = verifyPayload(req.cookies?.[AGE_LOCK_COOKIE]);
  return p && p.kind === "agelock" ? { locked: true, until: p.exp } : { locked: false };
}

export function buildAuth(store) {
  const router = express.Router();

  // ---- session helpers ---------------------------------------------------
  async function startSession(req, res, user) {
    const token = newToken();
    await store.createSession({
      token_hash: sha256(token),
      user_id: user.id,
      expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      user_agent: cleanText(req.get("user-agent"), 160),
    });
    res.cookie(SESSION_COOKIE, token, { ...baseCookie, maxAge: SESSION_TTL_MS });
  }

  async function requireAuth(req, res, next) {
    try {
      const token = req.cookies?.[SESSION_COOKIE];
      if (!token || typeof token !== "string" || token.length > 100) return res.status(401).json({ error: "not_signed_in" });
      const session = await store.getSession(sha256(token));
      if (!session) {
        res.clearCookie(SESSION_COOKIE, baseCookie);
        return res.status(401).json({ error: "not_signed_in" });
      }
      const user = await store.findUserById(session.user_id);
      if (!user) return res.status(401).json({ error: "not_signed_in" });
      req.user = user;
      req.sessionHash = session.token_hash;
      next();
    } catch (err) {
      next(err);
    }
  }

  // ---- rate limits (generous enough for a shared campus IP) ---------------
  const ageCheckLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false,
    handler: json429("Too many attempts. Take a break and try again later.") });
  const signupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false,
    handler: json429("Too many sign-ups from this network. Try again in a bit.") });
  const loginIpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: "draft-8", legacyHeaders: false,
    handler: json429("Too many login attempts. Wait 15 minutes and try again.") });
  // Per-account brute-force guard: 5 failed tries per roll number / 15 min.
  const loginRollLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 5, skipSuccessfulRequests: true, standardHeaders: "draft-8", legacyHeaders: false,
    keyGenerator: (req) => "roll:" + sha256(String(req.body?.roll || "").trim().toLowerCase()),
    handler: json429("Too many wrong passwords for this roll number. Wait 15 minutes."),
  });

  const deleteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 5, skipSuccessfulRequests: true, standardHeaders: "draft-8", legacyHeaders: false,
    keyGenerator: (req) => "del:" + req.user.id,
    handler: json429("Too many wrong passwords. Wait 15 minutes."),
  });

  // ---- public config -----------------------------------------------------
  router.get("/config", (req, res) => {
    const demoOn = process.env.DEMO_ACCOUNT !== "off";
    res.json({
      demo: demoOn ? { roll: DEMO_ROLL, password: DEMO_PASSWORD } : null,
      ageGate: ageLockInfo(req),
    });
  });

  // ---- step 2 of signup: the age gate --------------------------------------
  router.post("/age-check", ageCheckLimiter, (req, res) => {
    const lock = ageLockInfo(req);
    if (lock.locked) return res.status(403).json({ error: "age_gate_locked", until: lock.until });

    const dob = String(req.body?.dob || "");
    if (!parseDob(dob)) return res.status(400).json({ error: "invalid_dob", message: "That date doesn't exist. Check day, month and year." });
    const age = ageOn(dob);
    if (age < 0) return res.status(400).json({ error: "invalid_dob", message: "That date is in the future." });
    if (age > 100) return res.status(400).json({ error: "invalid_dob", message: "Please check the year you picked." });

    if (age < MIN_AGE) {
      const until = Date.now() + AGE_LOCK_MS;
      res.cookie(AGE_LOCK_COOKIE, signPayload({ kind: "agelock", exp: until }), { ...baseCookie, maxAge: AGE_LOCK_MS });
      return res.status(403).json({ error: "under_age", until });
    }
    const now = Date.now();
    const ageToken = signPayload({ kind: "age", adult: true, iat: now, exp: now + AGE_TOKEN_TTL_MS, n: crypto.randomBytes(12).toString("base64url") });
    // The DOB is not stored or logged anywhere — it goes out of scope here.
    return res.json({ ok: true, ageToken, expiresAt: now + AGE_TOKEN_TTL_MS });
  });

  // ---- signup ---------------------------------------------------------------
  router.post("/signup", signupLimiter, async (req, res, next) => {
    try {
      if (ageLockInfo(req).locked) return res.status(403).json({ error: "age_gate_locked" });

      const age = verifyPayload(req.body?.ageToken);
      if (!age || age.kind !== "age" || age.adult !== true) {
        return res.status(403).json({ error: "age_check_required", message: "Please complete the age check again." });
      }
      if (spentAgeNonces.has(age.n)) return res.status(403).json({ error: "age_check_required", message: "Please complete the age check again." });

      const name = cleanText(req.body?.name, 60);
      const roll = cleanText(req.body?.roll, 15);
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      if (!NAME_RE.test(name)) return res.status(400).json({ error: "invalid_name", message: "Use your real name (letters only, 2–60 characters)." });
      if (!ROLL_RE.test(roll)) return res.status(400).json({ error: "invalid_roll", message: "Roll numbers are 6–15 letters/numbers, like 23BCS10432." });
      const pwErr = passwordProblem(password, { roll, name });
      if (pwErr) return res.status(400).json({ error: "weak_password", message: pwErr });
      if (req.body?.consent !== true) return res.status(400).json({ error: "consent_required", message: "Please accept the privacy notice to continue." });

      spentAgeNonces.set(age.n, age.exp);
      let user;
      try {
        user = await store.createUser({
          roll,
          roll_lower: roll.toLowerCase(),
          name,
          password_hash: await hashPassword(password),
          age_verified_adult: true,
          age_checked_at: new Date(age.iat).toISOString(),
          consent_at: new Date().toISOString(),
        });
      } catch (err) {
        if (err instanceof DuplicateError) {
          spentAgeNonces.delete(age.n);
          return res.status(409).json({ error: "roll_taken", message: "That roll number already has an account. Try logging in." });
        }
        throw err;
      }
      await startSession(req, res, user);
      return res.status(201).json({ user: publicUser(user, { activeSessions: 1 }) });
    } catch (err) { next(err); }
  });

  // ---- login --------------------------------------------------------------
  router.post("/login", loginIpLimiter, loginRollLimiter, async (req, res, next) => {
    try {
      const roll = cleanText(req.body?.roll, 15);
      const password = typeof req.body?.password === "string" ? req.body.password.slice(0, 128) : "";
      const user = ROLL_RE.test(roll) ? await store.findUserByRoll(roll.toLowerCase()) : null;
      // Always run one scrypt verification so "no such user" and "wrong
      // password" take the same time and return the same message.
      const ok = await verifyPassword(password, user ? user.password_hash : await dummyHash());
      if (!user || !ok) return res.status(401).json({ error: "invalid_credentials", message: "Roll number or password doesn't match." });

      // Rotate: any session cookie the browser had is replaced by a fresh one.
      const old = req.cookies?.[SESSION_COOKIE];
      if (old) await store.deleteSession(sha256(old));
      await startSession(req, res, user);
      await store.setLastLogin(user.id);
      const sessions = await store.countSessionsForUser(user.id);
      return res.json({ user: publicUser({ ...user, last_login_at: new Date().toISOString() }, { activeSessions: sessions }) });
    } catch (err) { next(err); }
  });

  router.get("/me", requireAuth, async (req, res, next) => {
    try {
      const sessions = await store.countSessionsForUser(req.user.id);
      res.json({ user: publicUser(req.user, { activeSessions: sessions }) });
    } catch (err) { next(err); }
  });

  router.post("/logout", requireAuth, async (req, res, next) => {
    try {
      await store.deleteSession(req.sessionHash);
      res.clearCookie(SESSION_COOKIE, baseCookie);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // The shared judges' demo account can't sign everyone out or be deleted,
  // otherwise one visitor could lock every other judge out of the demo.
  const demoGuard = (req, res, next) => (isDemoUser(req.user)
    ? res.status(403).json({ error: "demo_locked", message: "That's switched off on the shared demo account. Create your own account to try it." })
    : next());

  router.post("/logout-all", requireAuth, demoGuard, async (req, res, next) => {
    try {
      await store.deleteSessionsForUser(req.user.id);
      res.clearCookie(SESSION_COOKIE, baseCookie);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // Right to erasure (DPDP Act s.12): re-enter password, account and all
  // sessions are deleted immediately.
  router.post("/delete-account", requireAuth, demoGuard, deleteLimiter, async (req, res, next) => {
    try {
      const password = typeof req.body?.password === "string" ? req.body.password.slice(0, 128) : "";
      if (!(await verifyPassword(password, req.user.password_hash))) {
        return res.status(401).json({ error: "invalid_credentials", message: "Password doesn't match." });
      }
      await store.deleteUser(req.user.id);
      res.clearCookie(SESSION_COOKIE, baseCookie);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  return { router, requireAuth };
}

// ---------------------------------------------------------------------------
// Demo account for judges (hashed at startup, never stored in the frontend).
// Turn off with DEMO_ACCOUNT=off before any real deployment.
// ---------------------------------------------------------------------------
export const DEMO_ROLL = process.env.DEMO_ROLL || "23BCS10432";
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "Ghost-Demo-2026";
export function isDemoUser(u) {
  return process.env.DEMO_ACCOUNT !== "off" && !!u && u.roll_lower === DEMO_ROLL.toLowerCase();
}

export async function ensureDemoUser(store) {
  if (process.env.DEMO_ACCOUNT === "off") return;
  const existing = await store.findUserByRoll(DEMO_ROLL.toLowerCase());
  if (existing) return;
  await store.createUser({
    roll: DEMO_ROLL,
    roll_lower: DEMO_ROLL.toLowerCase(),
    name: "Aryan",
    password_hash: await hashPassword(DEMO_PASSWORD),
    age_verified_adult: true,
    age_checked_at: new Date().toISOString(),
    consent_at: new Date().toISOString(),
  });
  console.log(`[auth] demo account ready: ${DEMO_ROLL}`);
}
