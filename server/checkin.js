// Room check-in: who is actually in a room right now.
//
// - A booking must be checked into within a few minutes (door QR or the
//   "Check in" button), otherwise the app releases the room for others.
// - Scanning a room's door QR without a booking is a walk-in check-in.
// - Everyone signed in sees only COUNTS per room ("3 here"), never names.
//
// Data minimisation: one row per person, only while they are checked in.
// Checking out or the time running out deletes it. Nothing is kept as
// history, so no behaviour profile is built (also important for under-18s).
//
// Routes (mounted under /api, signed-in users only):
//   GET    /checkins       -> { mine, counts }
//   POST   /checkins       -> check in { roomId, minutes, method: "qr" | "tap" }
//   DELETE /checkins/me    -> check out
import express from "express";

// Keep in sync with STUDY_ROOMS in src/App.jsx (rooms people can sit in).
export const CHECKIN_ROOMS = ["A2-104", "D-Block-LT3", "CSE-Lab-9", "A1-212", "Library-Pod-4", "D-Block-210", "demo-room"];
export const MIN_MINUTES = 15;
export const MAX_MINUTES = 180;
const DEFAULT_MINUTES = 60;

export function buildCheckins({ requireAuth, sameOriginOnly, client: injected = null, now = () => Date.now() }) {
  const router = express.Router();
  const active = new Map(); // userId -> { roomId, at, expiresAt, method }

  // ---- Supabase write-through (optional). The in-memory map is what answers
  // requests; Supabase only makes check-ins survive a server restart.
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let sbPromise = injected ? Promise.resolve(injected) : null;
  const sb = () => {
    if (injected) return sbPromise;
    if (!url || !key) return null;
    sbPromise ||= import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
    return sbPromise;
  };
  const warn = (e) => console.warn("[checkin] storage:", e.message);
  async function dbUpsert(userId, c) {
    const p = sb(); if (!p) return;
    const r = await (await p).from("gs_checkins").upsert({
      user_id: userId, room_id: c.roomId, method: c.method,
      checked_in_at: new Date(c.at).toISOString(), expires_at: new Date(c.expiresAt).toISOString(),
    });
    if (r.error) throw new Error(r.error.message);
  }
  async function dbDelete(userId) {
    const p = sb(); if (!p) return;
    const r = await (await p).from("gs_checkins").delete().eq("user_id", userId);
    if (r.error) throw new Error(r.error.message);
  }
  async function dbLoad() {
    const p = sb(); if (!p) return;
    const client = await p;
    await client.from("gs_checkins").delete().lte("expires_at", new Date(now()).toISOString());
    const r = await client.from("gs_checkins").select("user_id,room_id,method,checked_in_at,expires_at");
    if (r.error) throw new Error(r.error.message);
    for (const x of r.data || []) {
      if (!CHECKIN_ROOMS.includes(x.room_id)) continue;
      active.set(String(x.user_id), { roomId: x.room_id, method: x.method, at: Date.parse(x.checked_in_at), expiresAt: Date.parse(x.expires_at) });
    }
  }
  const ready = dbLoad().catch(warn);

  function prune() {
    const t = now();
    for (const [u, c] of active) if (c.expiresAt <= t) active.delete(u);
  }
  function counts() {
    prune();
    const out = {};
    for (const c of active.values()) out[c.roomId] = (out[c.roomId] || 0) + 1;
    return out;
  }
  const view = (c) => (c ? { roomId: c.roomId, method: c.method, checkedInAt: new Date(c.at).toISOString(), expiresAt: new Date(c.expiresAt).toISOString() } : null);
  const roleOf = (u) => u.role || "student";

  router.get("/checkins", requireAuth, async (req, res) => {
    await ready;
    prune();
    res.json({ mine: view(active.get(String(req.user.id))), counts: counts() });
  });

  router.post("/checkins", sameOriginOnly, requireAuth, async (req, res) => {
    await ready;
    if (roleOf(req.user) === "facilities") return res.status(403).json({ error: "facilities_cannot_check_in" });
    const { roomId, minutes, method } = req.body || {};
    if (typeof roomId !== "string" || !CHECKIN_ROOMS.includes(roomId)) return res.status(400).json({ error: "unknown_room" });
    const m = minutes === undefined ? DEFAULT_MINUTES : Number(minutes);
    if (!Number.isInteger(m) || m < MIN_MINUTES || m > MAX_MINUTES) return res.status(400).json({ error: "bad_minutes" });
    if (method !== undefined && method !== "qr" && method !== "tap") return res.status(400).json({ error: "bad_method" });
    const t = now();
    const c = { roomId, method: method || "tap", at: t, expiresAt: t + m * 60 * 1000 };
    active.set(String(req.user.id), c); // one room at a time: a new check-in replaces the old one
    dbUpsert(String(req.user.id), c).catch(warn);
    res.status(201).json({ mine: view(c), counts: counts() });
  });

  router.delete("/checkins/me", sameOriginOnly, requireAuth, async (req, res) => {
    await ready;
    active.delete(String(req.user.id));
    dbDelete(String(req.user.id)).catch(warn);
    res.json({ mine: null, counts: counts() });
  });

  // Expired rows are pruned in memory on every read; this clears them in the DB too.
  const timer = setInterval(() => {
    prune();
    const p = sb();
    if (p) p.then((c) => c.from("gs_checkins").delete().lte("expires_at", new Date(now()).toISOString())).catch(warn);
  }, 5 * 60 * 1000);
  timer.unref?.();

  return Object.assign(router, { ready });
}
