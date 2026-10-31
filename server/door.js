// IR door counter for the Demo Room.
//
// An ESP32 at the door reads two IR beams (A outside, B inside). The board
// itself decides the direction from the order the beams break
// (A -> A+B -> B = IN, B -> A+B -> A = OUT, anything else ignored) and posts
// each event here. It also sends a heartbeat with the live beam states.
//
// Routes (mounted under /api):
//   POST /door/event      { event: "in" | "out", id }        device key
//   POST /door/heartbeat  { a: bool, b: bool, uptime }        device key
//   GET  /door/status     -> { online, inside, entries, exits, beams, events }
//   POST /door/reset      set the count (default 0)           admin key
//
// No personal data: only counts and timestamps. Kept in memory (a restart
// starts the day at 0, like the nightly reset when the room is locked).
import express from "express";

export const ROOM_ID = "demo-room";
const MAX_EVENTS = 30;

export function createDoorCounter({ now = () => Date.now(), offlineMs = 6000 } = {}) {
  const s = { entries: 0, exits: 0, beams: { a: false, b: false }, lastSeen: null, events: [], seenIds: new Set(), seenOrder: [] };
  const push = (kind, extra = {}) => {
    s.events.push({ at: new Date(now()).toISOString(), kind, ...extra });
    if (s.events.length > MAX_EVENTS) s.events.shift();
  };
  return {
    event(kind, id) {
      if (kind !== "in" && kind !== "out") return { ok: false, error: "event must be 'in' or 'out'" };
      // The board retries a post that failed; the id stops a retry counting twice.
      if (id != null) {
        const key = String(id).slice(0, 40);
        if (s.seenIds.has(key)) return { ok: true, duplicate: true };
        s.seenIds.add(key); s.seenOrder.push(key);
        if (s.seenOrder.length > 200) s.seenIds.delete(s.seenOrder.shift());
      }
      if (kind === "in") s.entries++; else s.exits++;
      s.lastSeen = now();
      push(kind);
      return { ok: true };
    },
    heartbeat(a, b) {
      s.beams = { a: !!a, b: !!b };
      s.lastSeen = now();
    },
    reset(inside = 0) {
      s.entries = Math.max(0, Math.floor(inside)); s.exits = 0;
      push("reset", { inside: s.entries });
    },
    status() {
      const online = s.lastSeen != null && now() - s.lastSeen <= offlineMs;
      return {
        roomId: ROOM_ID,
        online,
        lastSeen: s.lastSeen ? new Date(s.lastSeen).toISOString() : null,
        inside: Math.max(0, s.entries - s.exits),
        entries: s.entries,
        exits: s.exits,
        beams: online ? s.beams : { a: false, b: false },
        events: s.events.slice(-10),
      };
    },
  };
}

export function buildDoorRouter(counter, { requireDeviceKey, requireAdminKey }) {
  const r = express.Router();
  r.get("/door/status", (_req, res) => res.json(counter.status()));
  r.post("/door/event", requireDeviceKey, (req, res) => {
    const { event, id } = req.body || {};
    if (id != null && (typeof id !== "string" && typeof id !== "number")) return res.status(400).json({ error: "bad_id" });
    const out = counter.event(event, id);
    if (!out.ok) return res.status(400).json({ error: "bad_event", message: out.error });
    res.json({ ok: true, duplicate: !!out.duplicate, inside: counter.status().inside });
  });
  r.post("/door/heartbeat", requireDeviceKey, (req, res) => {
    const { a, b } = req.body || {};
    if (typeof a !== "boolean" || typeof b !== "boolean") return res.status(400).json({ error: "bad_beams" });
    counter.heartbeat(a, b);
    res.json({ ok: true, inside: counter.status().inside });
  });
  r.post("/door/reset", requireAdminKey, (req, res) => {
    const n = req.body?.inside ?? 0;
    if (!Number.isInteger(n) || n < 0 || n > 500) return res.status(400).json({ error: "bad_count" });
    counter.reset(n);
    res.json({ ok: true, status: counter.status() });
  });
  return r;
}
