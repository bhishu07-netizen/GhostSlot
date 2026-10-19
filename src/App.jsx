import React, { useState, useEffect, useMemo } from "react";
import Papa from "papaparse";
import {
  MapPin, Clock, Users, TrendingUp, Bell, Plug, Volume1,
  VolumeX, Search, ChevronRight, Sparkles, Trophy, Snowflake, X,
  CheckCircle2, Radar, Flame, MessageCircleMore, CalendarClock, Plus, Trash2,
  LogOut, Upload, Download, FileWarning,
  Info, Wand2, AlertTriangle, Building2, Sparkle, ArrowRight, RefreshCw, Wifi, Percent,
  ShieldCheck, MonitorSmartphone, Map as MapIcon, Activity,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Cell
} from "recharts";
import CampusAI from "./CampusAI";
import AuthScreen from "./auth/AuthScreen";
import PrivacyNotice from "./auth/PrivacyNotice";
import { BrandMark, Wordmark } from "./brand/BrandMark";
import { api } from "./api";
import CampusMap from "./CampusMap";
import Twin from "./Twin";
import { CAMPUS_SPACES, ROOM_POSITIONS, CATEGORIES, wifiStatus, crowdLabel } from "./campus";

// =========================================================================
// CONSTANTS
// =========================================================================
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PICKER_DAYS = [...DAYS, "Sun"];
// The demo story (seed timetables) is tuned for this moment.
const DEMO_DAY = "Mon";
const DEMO_TIME = "11:15";

// Current day + time on India's clock, whatever the viewer's device timezone.
function nowIST() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { day: get("weekday"), time: `${get("hour")}:${get("minute")}` };
}
const CAMPUS_START = "09:00";
const CAMPUS_END = "17:00";

const STUDY_ROOMS = [
  { id: "A2-104", name: "A2 · 104", block: "A2 Block", floor: "1st floor", capacity: 60, walk: "3 min walk", tags: ["plug", "ac"], vibe: "quiet", util7d: 22, type: "classroom",
    description: "Spacious A2 Block classroom with natural lighting and quiet surroundings. Great for solo study, revision, or focused individual work between classes." },
  { id: "D-Block-LT3", name: "D Block · LT-3", block: "D Block", floor: "Ground floor", capacity: 120, walk: "7 min walk", tags: ["plug"], vibe: "loud", util7d: 61, type: "lecture_hall",
    description: "Large lecture theatre with stadium seating for 120 and a projector setup. High demand during lunch hours — book it early or you're on the canteen floor." },
  { id: "CSE-Lab-9", name: "CSE Block · Lab 9", block: "CSE Block", floor: "2nd floor", capacity: 40, walk: "1 min walk", tags: ["plug", "ac", "wifi+"], vibe: "quiet", util7d: 12, type: "lab",
    description: "High-spec computer lab with 40 workstations, Wi-Fi+, and AC. Perfect for coding sessions, project work, or anything that needs a power socket and stable internet." },
  { id: "A1-212", name: "A1 · 212", block: "A1 Block", floor: "2nd floor", capacity: 70, walk: "5 min walk", tags: ["ac"], vibe: "medium", util7d: 44, type: "classroom",
    description: "Standard A1 Block classroom with good natural light and decent acoustics. Works well for group study sessions or quiet solo work when CSE is packed." },
  { id: "Library-Pod-4", name: "Library · Pod 4", block: "Central Library", floor: "3rd floor", capacity: 8, walk: "6 min walk", tags: ["plug", "wifi+", "ac"], vibe: "silent", util7d: 8, type: "pod",
    description: "Tucked-away study pod on the library's 3rd floor. Smallest spot on campus (8 seats) but the most peaceful — power outlets, Wi-Fi+, and AC all included." },
  { id: "D-Block-210", name: "D Block · 210", block: "D Block", floor: "2nd floor", capacity: 55, walk: "8 min walk", tags: ["plug"], vibe: "medium", util7d: 33, type: "classroom",
    description: "Mid-sized D Block classroom that most students walk past without noticing. Solid fallback option when everything closer is occupied — and it usually is free." },
  { id: "demo-room", name: "Demo Room", block: "CSE Block", floor: "Ground floor", capacity: 12, walk: "2 min walk", tags: ["plug", "wifi+"], vibe: "quiet", util7d: 0, type: "classroom",
    description: "GhostSlot's only physical-sensing room. Two ESP32-S3 nodes watch the room's Wi-Fi channel for changes as a live demo of Wi-Fi CSI (see the CSI status on its card).",
    csiEnabled: true },
];

// Whole campus = timetable rooms above + food / sports / hangout spaces
// (src/campus.js). Every space carries a category, how it's sensed, whether
// it can be booked, and its pin position on the campus map.
const ROOM_META = [
  ...STUDY_ROOMS.map((r) => ({ category: "study", sensing: r.csiEnabled ? "csi" : "timetable", bookable: true, hours: ["09:00", "17:00"], pos: ROOM_POSITIONS[r.id], ...r })),
  ...CAMPUS_SPACES.map((r) => ({ util7d: 0, pos: { x: r.x, y: r.y }, ...r })),
];
// Rooms whose availability comes from timetables (used by Timetable, Predict, CSV import).
const TIMETABLE_ROOMS = ROOM_META.filter((r) => r.sensing !== "wifi");

// seed data tuned so the default demo (Mon, 11:15) tells a clean story:
// student is free 11:00-13:00 -> CSE Lab 9 is wide open (best), A2-104 only
// has 45 real minutes left (worse), Library Pod 4 is open but far + small.
// Demo timetables repeat every weekday so the app tells the same story in
// live mode on any day, not just on Mondays.
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const everyWeekday = (slots) => slots.flatMap((s) => WEEKDAYS.map((d) => ({ ...s, id: d === "Mon" ? s.id : `${s.id}-${d}`, day: d })));

const SEED_ROOM_SLOTS_MON = {
  "A2-104": [{ id: "s1", day: "Mon", start: "09:00", end: "10:30", subject: "DBMS" }, { id: "s2", day: "Mon", start: "12:00", end: "13:00", subject: "OS Lab" }],
  "D-Block-LT3": [{ id: "s3", day: "Mon", start: "10:30", end: "13:00", subject: "Mechanics" }],
  "CSE-Lab-9": [{ id: "s4", day: "Mon", start: "15:00", end: "16:00", subject: "AI Lab" }],
  "A1-212": [{ id: "s5", day: "Mon", start: "09:00", end: "11:00", subject: "Maths III" }, { id: "s6", day: "Mon", start: "15:00", end: "17:00", subject: "EVS" }],
  "Library-Pod-4": [],
  "D-Block-210": [{ id: "s7", day: "Mon", start: "13:00", end: "14:30", subject: "COA" }],
  "demo-room": [],
};
const SEED_ROOM_SLOTS = Object.fromEntries(Object.entries(SEED_ROOM_SLOTS_MON).map(([k, v]) => [k, everyWeekday(v)]));

const SEED_MY_SLOTS_MON = [
  { id: "m1", day: "Mon", start: "09:00", end: "10:00", subject: "DSA" },
  { id: "m2", day: "Mon", start: "10:00", end: "11:00", subject: "DBMS" },
  { id: "m3", day: "Mon", start: "13:00", end: "14:00", subject: "OOPs" },
];
const SEED_MY_SLOTS = everyWeekday(SEED_MY_SLOTS_MON);

const SQUAD = [
  { name: "Ishaan", init: "IS", free: "free till 1:40", slot: "same as you" },
  { name: "Meher", init: "MH", free: "free till 2:00", slot: "same as you" },
  { name: "Devansh", init: "DV", free: "free in 20 min", slot: "next period" },
];

const NOTIFS = [
  { id: 1, text: "Lab 9 just ghosted its 11am class. It's yours if you want it.", time: "2m ago" },
  { id: 2, text: "You left A2·104 with 40 min still on the clock. Bold of you.", time: "1h ago" },
  { id: 3, text: "D Block LT-3 is about to get feral at 1pm. Book elsewhere.", time: "3h ago" },
];

const vibeMeta = {
  silent: { icon: VolumeX, label: "silent zone", color: "#C9CDD6" },
  quiet: { icon: VolumeX, label: "quiet-ish", color: "#D3D7DF" },
  medium: { icon: Volume1, label: "background hum", color: "#E6E8EC" },
  loud: { icon: Volume1, label: "chaos energy", color: "#FF6B6B" },
};

// CSI (Wi-Fi sensing) display states for the Demo Room only. CHANGE_DETECTED
// intentionally never says "occupied" — see server/csi.js for the pipeline
// that produces these states.
const CSI_STATE_META = {
  CALIBRATING: { dot: "🟡", label: "CSI calibrating" },
  NORMAL: { dot: "🟢", label: "CSI normal" },
  CHANGE_DETECTED: { dot: "🟠", label: "CSI change detected" },
  OFFLINE: { dot: "🔴", label: "CSI offline" },
  UNKNOWN: { dot: "⚪", label: "CSI status unknown" },
};

const LOCATIONS = ["Anywhere", "CSE Block", "A1 Block", "A2 Block", "Central Library", "D Block"];
const DURATION_PRESETS = [30, 60, 90, 120];
const DEFAULT_PREFS = { category: null, duration: 60, location: "Anywhere", vibe: null, requirements: [], capacity: 0, freeText: "", sortBy: "bestMatch", roomType: null, walkTime: null, freeOnly: false };
const DEMO_QUERY = "I need a quiet place near CSE for 90 minutes with charging.";

// =========================================================================
// TIME HELPERS
// =========================================================================
function toMin(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function toHHMM(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function fmtMin(m) {
  if (m >= 60) { const h = Math.floor(m / 60), rest = m % 60; return `${h}h${rest ? ` ${rest}m` : ""}`; }
  return `${m}m`;
}
// merge occupied slots for a given day, return sorted non-overlapping busy intervals (in minutes)
function busyIntervals(slots, day) {
  const todays = slots.filter((s) => s.day === day).map((s) => [toMin(s.start), toMin(s.end)]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of todays) {
    if (merged.length && s <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    } else merged.push([s, e]);
  }
  return merged;
}
// invert busy intervals within campus window -> free windows
function freeWindows(slots, day) {
  const busy = busyIntervals(slots, day);
  const start = toMin(CAMPUS_START), end = toMin(CAMPUS_END);
  const free = [];
  let cursor = start;
  for (const [s, e] of busy) {
    if (s > cursor) free.push([cursor, Math.min(s, end)]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < end) free.push([cursor, end]);
  return free.filter(([s, e]) => e > s);
}
// status of a room at a given minute on a given day
function roomStatus(slots, day, nowMin) {
  // Teaching blocks are shut on Sundays and outside campus hours.
  const open = toMin(CAMPUS_START), close = toMin(CAMPUS_END);
  if (day === "Sun" || nowMin >= close) {
    const nextDay = day === "Sat" || day === "Sun" ? "Mon" : "tomorrow";
    return { free: false, closed: true, busyUntil: `${CAMPUS_START} ${nextDay}`, freeFor: 0 };
  }
  if (nowMin < open) return { free: false, closed: true, busyUntil: CAMPUS_START, freeFor: 0 };
  const busy = busyIntervals(slots, day);
  const current = busy.find(([s, e]) => nowMin >= s && nowMin < e);
  if (current) return { free: false, busyUntil: toHHMM(current[1]) };
  const next = busy.find(([s]) => s > nowMin);
  const until = next ? next[0] : toMin(CAMPUS_END);
  return { free: true, freeUntilMin: until, freeFor: Math.max(0, until - nowMin) };
}
// Wi-Fi-sensed spaces (food court, courts, library…) use opening hours + crowd;
// timetable rooms use the timetable. Same output shape either way.
function spaceStatus(room, slots, day, nowMin) {
  return room.sensing === "wifi" ? wifiStatus(room, day, nowMin) : roomStatus(slots, day, nowMin);
}
function inAnyWindow(windows, min) {
  return windows.some(([s, e]) => min >= s && min < e);
}
// how many minutes remain in whatever free window contains `atMin` (0 if not in one)
function getAvailableDuration(windows, atMin) {
  const w = windows.find(([s, e]) => atMin >= s && atMin < e);
  return w ? w[1] - atMin : 0;
}
// first window (anywhere in the day) long enough to hold `duration` minutes
function findCompatibleFreeWindow(windows, duration) {
  return windows.find(([s, e]) => e - s >= duration) || null;
}

// =========================================================================
// NATURAL-LANGUAGE INTENT PARSER
// Local, rule-based — no external API/key needed. Deliberately structured
// so a real LLM call could be swapped in later behind the same signature.
// =========================================================================
function parseNaturalLanguageQuery(raw) {
  const q = (raw || "").toLowerCase().trim();
  const result = { duration: null, vibe: null, location: null, requirements: [], capacity: null };
  if (!q) return result;

  let m;
  if ((m = q.match(/(\d+)\s*(?:min|mins|minute|minutes)\b/))) result.duration = parseInt(m[1], 10);
  else if ((m = q.match(/(\d+(?:\.\d+)?)\s*(?:hr|hrs|hour|hours)\b/))) result.duration = Math.round(parseFloat(m[1]) * 60);
  else if (/half an? hour/.test(q)) result.duration = 30;
  else if (/\ban hour\b/.test(q)) result.duration = 60;
  else if (/couple (?:of )?hours/.test(q)) result.duration = 120;

  const vibeMap = { quiet: "quiet", silent: "silent", study: "quiet", focus: "quiet", peaceful: "quiet", social: "medium", group: "medium", loud: "loud", chaos: "loud", chill: "medium" };
  for (const key of Object.keys(vibeMap)) {
    if (new RegExp(`\\b${key}\\b`).test(q)) { result.vibe = vibeMap[key]; break; }
  }

  const locationMap = [
    [/\bcse\b/, "CSE Block"],
    [/\blibrary\b/, "Central Library"],
    [/\ba ?1\b|a1 block/, "A1 Block"],
    [/\ba ?2\b|a2 block/, "A2 Block"],
    [/\bd block\b|block d\b/, "D Block"],
  ];
  for (const [re, block] of locationMap) { if (re.test(q)) { result.location = block; break; } }

  if (/charg(e|ing)|\bplug\b|\bpower\b|\bsocket\b/.test(q)) result.requirements.push("plug");
  if (/wi[- ]?fi\+?|\binternet\b/.test(q)) result.requirements.push("wifi+");
  if (/\bac\b|air ?condition/.test(q)) result.requirements.push("ac");

  if ((m = q.match(/\bfor (\d{1,3})\b(?!\s*(?:min|mins|minute|minutes|hr|hrs|hour|hours))/))) result.capacity = parseInt(m[1], 10);
  else if ((m = q.match(/(\d{1,3})\s*(?:people|students|seats|persons)\b/))) result.capacity = parseInt(m[1], 10);

  if (!result.vibe && /\bgroup\b|group work/.test(q)) result.vibe = "medium";
  if (!result.vibe && /\bstudy\b|\bfocus\b/.test(q)) result.vibe = "quiet";

  return result;
}

// =========================================================================
// NATURAL-LANGUAGE INTENT PARSER — GEMINI-POWERED (via our server)
// Same output shape as parseNaturalLanguageQuery. The Gemini key lives only
// on the server (POST /api/ai/parse); the browser never sees it. Callers
// fall back to parseNaturalLanguageQuery on any failure.
// =========================================================================
async function parseQueryWithGemini(raw) {
  const p = await api("/ai/parse", { method: "POST", body: { query: String(raw).slice(0, 300) } });
  return {
    duration: typeof p.duration === "number" ? p.duration : null,
    vibe: p.vibe || null,
    location: p.location || null,
    requirements: Array.isArray(p.requirements) ? p.requirements.filter((r) => ["plug", "wifi+", "ac"].includes(r)) : [],
    capacity: typeof p.capacity === "number" ? p.capacity : null,
  };
}

// CSV safety limits (uploads are parsed in the browser only).
const CSV_MAX_BYTES = 256 * 1024;
const CSV_MAX_ROWS = 500;
function cleanCell(v, max = 60) {
  return String(v ?? "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
}

function summarizePrefs(prefs) {
  const parts = [];
  if (prefs.duration) parts.push(`${prefs.duration} min`);
  if (prefs.vibe) parts.push(prefs.vibe);
  if (prefs.location && prefs.location !== "Anywhere") parts.push(prefs.location.replace(" Block", "").replace("Central ", ""));
  if (prefs.requirements?.length) parts.push(prefs.requirements.map((r) => (r === "plug" ? "charging" : r === "wifi+" ? "Wi-Fi" : "AC")).join(" + "));
  if (prefs.capacity) parts.push(`${prefs.capacity}+ seats`);
  return parts;
}

const VIBE_EQUIVALENTS = { quiet: ["quiet", "silent"], silent: ["silent"], medium: ["medium"], loud: ["loud", "medium"] };

// =========================================================================
// RECOMMENDATION / SCORING ENGINE
// =========================================================================
function calculateRoomScore(room, status, prefs) {
  const requestedDuration = prefs.duration || 30;

  let durationScore;
  if (!status.free) durationScore = 0;
  else if (status.freeFor >= requestedDuration) durationScore = 1;
  else durationScore = 0.35 * (status.freeFor / requestedDuration);

  const reqs = prefs.requirements || [];
  const requirementsScore = reqs.length ? reqs.filter((r) => room.tags.includes(r)).length / reqs.length : 1;

  const walkMin = parseInt((room.walk.match(/\d+/) || [5])[0], 10) || 5;
  const baseDistance = Math.max(0, 1 - (walkMin - 1) / 9);
  let distanceScore = baseDistance;
  if (prefs.location && prefs.location !== "Anywhere") distanceScore = room.block === prefs.location ? 1 : 0.15;

  let vibeScore = 1;
  if (prefs.vibe) vibeScore = (VIBE_EQUIVALENTS[prefs.vibe] || [prefs.vibe]).includes(room.vibe) ? 1 : 0.25;

  const utilScore = Math.max(0, 1 - (typeof status.crowd === "number" ? status.crowd : room.util7d) / 100);

  let capacityScore = 0.8;
  if (prefs.capacity) capacityScore = room.capacity >= prefs.capacity ? 1 : 0.15;

  const weights = { duration: 0.35, requirements: 0.25, distance: 0.15, vibe: 0.10, util: 0.10, capacity: 0.05 };
  const raw =
    weights.duration * durationScore +
    weights.requirements * requirementsScore +
    weights.distance * distanceScore +
    weights.vibe * vibeScore +
    weights.util * utilScore +
    weights.capacity * capacityScore;

  return { score: Math.round(raw * 100), durationScore, requirementsScore, distanceScore, vibeScore, utilScore, capacityScore };
}

function getRecommendationExplanation(room, status, prefs) {
  const requestedDuration = prefs.duration || 30;
  const lines = [];
  if (room.sensing === "wifi") {
    if (status.closed) lines.push(`Closed now · opens ${status.busyUntil}`);
    else lines.push(`${crowdLabel(status.crowd).label[0].toUpperCase()}${crowdLabel(status.crowd).label.slice(1)} right now · ${status.crowd}% full (campus Wi-Fi)`);
    if (!status.closed) lines.push(`Open until ${room.hours[1]}`);
    if (prefs.vibe && (VIBE_EQUIVALENTS[prefs.vibe] || [prefs.vibe]).includes(room.vibe)) lines.push(`${vibeMeta[room.vibe].label} — matches your vibe`);
    (prefs.requirements || []).forEach((r) => { if (room.tags.includes(r)) lines.push(r === "plug" ? "Charging available" : r === "wifi+" ? "Wi-Fi+ available" : "AC available"); });
    lines.push(room.walk);
    lines.push(room.bookable ? "Bookable in GhostSlot" : "Walk in · no booking needed");
    return lines;
  }
  if (status.free && status.freeFor >= requestedDuration) lines.push(`Free for ${fmtMin(status.freeFor)} — covers your ${requestedDuration} min ask`);
  else if (status.free) lines.push(`Free for ${fmtMin(status.freeFor)} — a bit short of your ${requestedDuration} min ask`);
  else lines.push(`Occupied until ${status.busyUntil}`);
  if (prefs.vibe && (VIBE_EQUIVALENTS[prefs.vibe] || [prefs.vibe]).includes(room.vibe)) lines.push(`${vibeMeta[room.vibe].label} — matches your vibe`);
  (prefs.requirements || []).forEach((r) => {
    if (room.tags.includes(r)) lines.push(r === "plug" ? "Charging available" : r === "wifi+" ? "Wi-Fi+ available" : "AC available");
  });
  if (prefs.location && prefs.location !== "Anywhere" && room.block === prefs.location) lines.push(`Right in ${prefs.location}`);
  lines.push(room.walk);
  if (room.util7d < 25) lines.push(`Low weekly utilization (${room.util7d}%) — rarely booked`);
  return lines;
}

// =========================================================================
// DEMAND FORECASTING (local heuristic — explicitly NOT a trained ML model)
// =========================================================================
function calculateShortageRisk(hourMin, day, roomSlots) {
  const statuses = TIMETABLE_ROOMS.map((r) => roomStatus(roomSlots[r.id] || [], day, hourMin));
  const busyRatio = statuses.filter((s) => !s.free).length / TIMETABLE_ROOMS.length;
  const avgUtil = TIMETABLE_ROOMS.reduce((a, r) => a + r.util7d, 0) / TIMETABLE_ROOMS.length / 100;
  return Math.round(100 * Math.min(1, 0.65 * busyRatio + 0.35 * avgUtil));
}
function hourLabel(h) {
  if (h === 12) return "12pm";
  return h > 12 ? `${h - 12}pm` : `${h}am`;
}
function getUnderusedRooms(rooms, n = 3) {
  return [...rooms].sort((a, b) => a.util7d - b.util7d).slice(0, n).map((r) => ({ name: r.name, util: r.util7d }));
}

// =========================================================================
// SMALL UI ATOMS
// =========================================================================
function GhostMeter({ pct, height = 10 }) {
  const blocks = 10;
  const filled = Math.round((pct / 100) * blocks);
  const color = pct < 30 ? "#3DDC97" : pct < 65 ? "#F5B544" : "#FF6B6B";
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {Array.from({ length: blocks }).map((_, i) => (
        <div key={i} style={{ width: 8, height, borderRadius: 2, background: i < filled ? color : "rgba(255,255,255,0.08)", transition: "background 300ms ease" }} />
      ))}
    </div>
  );
}

function Pill({ children, tone = "default" }) {
  const tones = {
    default: { bg: "rgba(255,255,255,0.06)", color: "#C9CDD6", border: "rgba(255,255,255,0.12)" },
    lime: { bg: "rgba(61,220,151,0.12)", color: "#3DDC97", border: "rgba(61,220,151,0.3)" },
    coral: { bg: "rgba(255,107,107,0.12)", color: "#FF8B8B", border: "rgba(255,107,107,0.3)" },
    amber: { bg: "rgba(245,181,68,0.12)", color: "#F5B544", border: "rgba(245,181,68,0.3)" },
  };
  const t = tones[tone];
  return (
    <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", padding: "3px 8px", borderRadius: 999, background: t.bg, color: t.color, border: `1px solid ${t.border}`, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

// room status label used consistently across the app
function statusMeta(room, status, prefs, booking) {
  if (booking && booking.roomId === room.id) return { tone: "default", label: `booked by you · ${fmtMin(Math.ceil(booking.secondsLeft / 60))} left` };
  if (room.sensing === "wifi") {
    if (status.closed) return { tone: "coral", label: `closed · opens ${status.busyUntil}` };
    if (status.full) return { tone: "coral", label: `packed · ${status.crowd}% full` };
    const c = crowdLabel(status.crowd);
    return { tone: c.tone, label: `${c.label} · ${status.crowd}% full` };
  }
  if (status.closed) return { tone: "coral", label: `closed · opens ${status.busyUntil}` };
  if (!status.free) return { tone: "coral", label: `occupied · free at ${status.busyUntil}` };
  const requestedDuration = prefs?.duration || 30;
  if (status.freeFor < requestedDuration) return { tone: "amber", label: `only ${fmtMin(status.freeFor)} available` };
  return { tone: "lime", label: `free for ${fmtMin(status.freeFor)}` };
}

function DemoRoomCsiBadge({ csi, onOpenDevDashboard }) {
  if (!csi) {
    return (
      <div style={{ marginTop: 2, fontSize: 11, color: "#6B6F79" }}>⚪ CSI status unavailable — backend not reachable</div>
    );
  }
  const m = CSI_STATE_META[csi.state] || CSI_STATE_META.UNKNOWN;
  return (
    <div style={{ marginTop: 2, display: "flex", flexDirection: "column", gap: 4, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "8px 10px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>{m.dot} {m.label}</span>
        {csi.mode === "simulation" && <Pill tone="amber">⚠ simulation mode</Pill>}
      </div>
      <div style={{ fontSize: 11, color: "#8B8F99" }}>
        Wi-Fi sensing: {csi.state === "OFFLINE" ? "unreachable" : "active"} · last update: {csi.secondsSinceUpdate == null ? "never" : `${csi.secondsSinceUpdate}s ago`}
      </div>
      {csi.state === "CHANGE_DETECTED" && (
        <div style={{ fontSize: 10.5, color: "#D9B26A" }}>A significant Wi-Fi channel change was detected — this is not a confirmed occupancy count.</div>
      )}
      {onOpenDevDashboard && (
        <button onClick={onOpenDevDashboard} style={{ alignSelf: "flex-start", marginTop: 2, background: "none", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, padding: "3px 8px", fontSize: 10.5, color: "#8B8F99", cursor: "pointer" }}>
          🛠 Developer view
        </button>
      )}
    </div>
  );
}

function RoomCard({ room, status, prefs, booking, onBook, hasActiveBooking, highlight, scoreBadge, csi, onOpenDevDashboard }) {
  const vm = vibeMeta[room.vibe];
  const VibeIcon = vm.icon;
  const meta = statusMeta(room, status, prefs, booking);
  const isMine = booking && booking.roomId === room.id;
  const canBook = room.bookable !== false && status.free && !hasActiveBooking;
  return (
    <div style={{ background: "#101114", border: highlight ? "1px solid rgba(211,215,223,0.4)" : "1px solid rgba(255,255,255,0.07)", borderRadius: 18, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 17, fontWeight: 700, color: "#F4F5F7" }}>{room.name}</div>
          <div style={{ fontSize: 12.5, color: "#8B8F99", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
            <MapPin size={12} /> {room.floor} · {room.walk}
          </div>
          {room.description && <div style={{ fontSize: 11.5, color: "#5F636D", marginTop: 4, lineHeight: 1.45 }}>{room.description}</div>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          {typeof scoreBadge === "number" && <Pill tone="lime">{scoreBadge}% match</Pill>}
          <Pill tone={meta.tone}><Clock size={10} style={{ marginRight: 4, verticalAlign: -1 }} />{meta.label}</Pill>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <GhostMeter pct={room.sensing === "wifi" ? (status.crowd || 0) : room.util7d} />
        <span style={{ fontSize: 11, color: "#6B6F79", fontFamily: "'JetBrains Mono', monospace" }}>
          {room.sensing === "wifi" ? (status.closed ? `opens ${status.busyUntil}` : `Wi-Fi crowd · ${status.crowd}% full`) : `${room.util7d}% booked this week`}
        </span>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Pill><Users size={10} style={{ marginRight: 4, verticalAlign: -1 }} />{room.capacity} seats</Pill>
        <Pill><VibeIcon size={10} style={{ marginRight: 4, verticalAlign: -1 }} />{vm.label}</Pill>
        {room.tags.includes("plug") && <Pill><Plug size={10} style={{ marginRight: 4, verticalAlign: -1 }} />plugs</Pill>}
        {room.tags.includes("wifi+") && <Pill><Wifi size={10} style={{ marginRight: 4, verticalAlign: -1 }} />wifi+</Pill>}
      </div>

      {room.csiEnabled && <DemoRoomCsiBadge csi={csi} onOpenDevDashboard={onOpenDevDashboard} />}

      {!room.bookable ? (
        <div style={{ marginTop: 4, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "9px 12px", fontSize: 12.5, color: "#8B8F99", textAlign: "center" }}>
          {status.closed ? `Closed now · opens ${status.busyUntil}` : "Walk in · no booking needed"}
        </div>
      ) : isMine ? (
        <div style={{ marginTop: 4, background: "rgba(211,215,223,0.12)", border: "1px solid rgba(211,215,223,0.3)", borderRadius: 12, padding: "9px 12px", fontSize: 12.5, color: "#C9CDD6", textAlign: "center", fontWeight: 700 }}>
          🔒 Reserved by you
        </div>
      ) : (
        <button onClick={() => canBook && onBook(room, status)} disabled={!canBook} style={{
          marginTop: 4, background: canBook ? "#D3D7DF" : "rgba(255,255,255,0.06)", color: canBook ? "#060607" : "#6B6F79",
          border: "none", borderRadius: 12, padding: "10px 14px", fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", fontSize: 14,
          cursor: canBook ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}>
          {status.closed ? "closed right now" : !status.free ? "occupied right now" : hasActiveBooking ? "end current booking first" : <>Lock it in <ChevronRight size={15} /></>}
        </button>
      )}
    </div>
  );
}

function TimeDayPicker({ day, setDay, time, setTime, live, onLive, onDemo }) {
  const ctl = { background: "transparent", color: "#F4F5F7", border: "none", fontSize: 12.5, fontFamily: "'JetBrains Mono', monospace" };
  const chip = (active) => ({ background: active ? "rgba(61,220,151,0.14)" : "rgba(255,255,255,0.05)", color: active ? "#3DDC97" : "#C9CDD6",
    border: `1px solid ${active ? "rgba(61,220,151,0.35)" : "rgba(255,255,255,0.12)"}`, borderRadius: 999, padding: "2px 8px", fontSize: 10.5, cursor: "pointer", whiteSpace: "nowrap" });
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: "#101114", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "8px 10px" }}>
      <CalendarClock size={14} color="#8B8F99" />
      <select aria-label="Day" value={day} onChange={(e) => setDay(e.target.value)} style={ctl}>
        {PICKER_DAYS.map((d) => <option key={d} value={d} style={{ background: "#101114" }}>{d}</option>)}
      </select>
      <span style={{ color: "#2A2D35" }}>|</span>
      <input aria-label="Time" type="time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} style={ctl} />
      {live
        ? <span title="Following the real time in India" style={chip(true)}>● live IST</span>
        : <button onClick={onLive} title="Go back to the real time in India" style={chip(false)}>back to now</button>}
      {!(day === DEMO_DAY && time === DEMO_TIME && !live) && (
        <button onClick={onDemo} title="Jump to the time the demo data is set up for" style={chip(false)}>demo time</button>
      )}
    </div>
  );
}

function CsvImport({ label, hint, onFile, onTemplate, summary }) {
  return (
    <div style={{ background: "#121317", border: "1px dashed rgba(211,215,223,0.35)", borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#F4F5F7" }}>{label}</div>
        <button onClick={onTemplate} style={{ background: "none", border: "none", color: "#8B8F99", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
          <Download size={11} /> template
        </button>
      </div>
      <label style={{ background: "#D3D7DF", color: "#060607", border: "none", borderRadius: 10, padding: "9px 10px", fontWeight: 700, fontSize: 12.5, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <Upload size={14} /> upload CSV
        <input type="file" accept=".csv" onChange={onFile} style={{ display: "none" }} />
      </label>
      <div style={{ fontSize: 10.5, color: "#6B6F79", display: "flex", alignItems: "flex-start", gap: 4 }}>
        <FileWarning size={11} style={{ marginTop: 1, flexShrink: 0 }} />
        <span>{hint}</span>
      </div>
      {summary && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
          <Pill tone="lime">Imported: {summary.added}</Pill>
          {summary.skipped > 0 && <Pill tone="amber">Skipped: {summary.skipped}</Pill>}
          {summary.conflicts > 0 && <Pill tone="coral">Conflicts: {summary.conflicts}</Pill>}
        </div>
      )}
    </div>
  );
}

function hasOverlap(existingSlots, day, start, end) {
  return existingSlots.some((s) => s.day === day && toMin(start) < toMin(s.end) && toMin(end) > toMin(s.start));
}

function SlotForm({ day, onAdd, roomOptions, existingSlotsFor }) {
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [subject, setSubject] = useState("");
  const [roomId, setRoomId] = useState(roomOptions ? roomOptions[0].id : null);
  const [error, setError] = useState("");

  function submit() {
    setError("");
    if (toMin(end) <= toMin(start)) { setError("End time has to be after the start time."); return; }
    if (toMin(start) < toMin(CAMPUS_START) || toMin(end) > toMin(CAMPUS_END)) { setError(`Keep it within campus hours (${CAMPUS_START}–${CAMPUS_END}).`); return; }
    const existing = existingSlotsFor ? existingSlotsFor(roomId) : [];
    if (hasOverlap(existing, day, start, end)) { setError("That overlaps an existing booking on this day."); return; }
    onAdd({ id: `x${Date.now()}`, day, start, end, subject: subject || "class" }, roomId);
    setSubject("");
  }

  return (
    <div style={{ background: "#16171B", borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      {roomOptions && (
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={{ background: "#101114", color: "#F4F5F7", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "8px 10px", fontSize: 12.5 }}>
          {roomOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={{ flex: 1, background: "#101114", color: "#F4F5F7", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "8px 10px", fontSize: 12.5 }} />
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={{ flex: 1, background: "#101114", color: "#F4F5F7", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "8px 10px", fontSize: 12.5 }} />
      </div>
      <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="subject / class code" style={{ background: "#101114", color: "#F4F5F7", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "8px 10px", fontSize: 12.5, outline: "none" }} />
      {error && <div style={{ fontSize: 11.5, color: "#FF8B8B" }}>{error}</div>}
      <button onClick={submit} style={{ background: "#E6E8EC", color: "#060607", border: "none", borderRadius: 10, padding: "8px 10px", fontWeight: 700, fontSize: 12.5, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
        <Plus size={13} /> add to {day}'s timetable
      </button>
    </div>
  );
}

function GhostSlotInfo() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: "#101114", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: 12 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ background: "none", border: "none", color: "#8B8F99", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
        <Info size={13} color="#D3D7DF" /> What's a Ghost Slot? <span style={{ marginLeft: "auto" }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={{ fontSize: 12, color: "#C9CCD3", lineHeight: 1.5, marginTop: 8 }}>
          A <b style={{ color: "#E6E8EC" }}>Ghost Slot</b> is a campus space that's technically assigned or timetabled — but sitting empty right now. GhostSlot discovers these hidden pockets of capacity and matches them to students who actually need space.
        </div>
      )}
    </div>
  );
}

// =========================================================================
// DEMO ROOM — CSI DEVELOPER DASHBOARD (debug view, separate from student UI)
// =========================================================================
function CsiDevDashboard({ csi, onClose }) {
  const row = (label, value) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 12.5 }}>
      <span style={{ color: "#8B8F99" }}>{label}</span>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#F4F5F7" }}>{value}</span>
    </div>
  );
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 30 }} />
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "min(100vw, 460px)", background: "#0E0F12", borderRadius: "20px 20px 0 0", zIndex: 35, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 -8px 40px rgba(0,0,0,0.6)" }}>
        <div style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16 }}>🛠 Demo Room — CSI Dev Dashboard</div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#8B8F99", cursor: "pointer" }}><X size={18} /></button>
          </div>
          {!csi ? (
            <div style={{ fontSize: 12.5, color: "#FF8B8B" }}>Backend unreachable — no CSI status available.</div>
          ) : (
            <>
              {csi.mode === "simulation" && (
                <div style={{ marginBottom: 10, fontSize: 11.5, fontWeight: 700, color: "#060607", background: "#E6E8EC", borderRadius: 10, padding: "6px 10px" }}>⚠ SIMULATION MODE — values are synthetic, not real CSI</div>
              )}
              {row("Mode", csi.mode)}
              {row("CSI state", csi.state)}
              {row("Calibration", csi.calibrationStatus)}
              {row("Baseline mean / std", csi.baseline ? `${csi.baseline.mean} / ${csi.baseline.std}` : "—")}
              {row("Samples collected", csi.samplesCollected)}
              {row("Last update", csi.secondsSinceUpdate == null ? "never" : `${csi.secondsSinceUpdate}s ago`)}
              {row("Node A (ESP32-S3 #1)", csi.devices["node-a"].online ? "ONLINE" : "OFFLINE")}
              {row("Node B (ESP32-S3 #2)", csi.devices["node-b"].online ? "ONLINE" : "OFFLINE")}
              {row("OLED display", csi.devices.oled.online ? "ONLINE" : "OFFLINE")}
              {row("Sample rate", `${csi.config.sampleRateMs} ms`)}
              {row("Baseline window", `${csi.config.baselineWindow} samples`)}
              {row("Smoothing window", `${csi.config.smoothingWindow} samples`)}
              {row("Change threshold", `${csi.config.changeThreshold}σ`)}
              {row("Offline timeout", `${csi.config.offlineTimeoutMs} ms`)}
              <div style={{ marginTop: 10, fontSize: 11, color: "#6B6F79", lineHeight: 1.5 }}>
                CHANGE_DETECTED means the room's Wi-Fi channel deviated from its calibrated baseline beyond the threshold above — it is a signal-level detection, not a validated occupancy or people count.
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// =========================================================================
// LOGIN SCREEN
// =========================================================================

const SORT_OPTIONS = [
  { id: "bestMatch", label: "Best Match", emoji: "✨" },
  { id: "freeFirst", label: "Free First", emoji: "🟢" },
  { id: "nearest", label: "Nearest", emoji: "🚶" },
  { id: "leastUsed", label: "Least Busy", emoji: "👻" },
  { id: "largest", label: "Largest", emoji: "📐" },
];
const ROOM_TYPE_OPTIONS = [
  { id: "classroom", label: "Classroom", emoji: "🏫" },
  { id: "lab", label: "Lab", emoji: "💻" },
  { id: "lecture_hall", label: "Lecture Hall", emoji: "🎭" },
  { id: "pod", label: "Study Pod", emoji: "🧘" },
];
const WALK_OPTIONS = [
  { id: null, label: "Any" },
  { id: 3, label: "≤3 min" },
  { id: 5, label: "≤5 min" },
  { id: 8, label: "≤8 min" },
];
const CAP_OPTIONS = [
  { id: 0, label: "Any" },
  { id: 1, label: "Cozy (≤20)" },
  { id: 21, label: "Medium (21–60)" },
  { id: 61, label: "Large (61+)" },
];

function FiltersPanel({ prefs, setPrefs, onClose, activeCount }) {
  function setSort(id) { setPrefs(p => ({ ...p, sortBy: id })); }
  function toggle(key, val) { setPrefs(p => ({ ...p, [key]: p[key] === val ? null : val })); }
  function setWalk(val) { setPrefs(p => ({ ...p, walkTime: val })); }
  function setCap(val) { setPrefs(p => ({ ...p, capacity: val })); }
  function toggleReq(tag) { setPrefs(p => ({ ...p, requirements: p.requirements.includes(tag) ? p.requirements.filter(r => r !== tag) : [...p.requirements, tag] })); }
  function clearAll() { setPrefs(DEFAULT_PREFS); }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 30 }} />
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "min(100vw, 460px)", background: "#0E0F12", borderRadius: "20px 20px 0 0", zIndex: 35, maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 -8px 40px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 2px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.15)" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 18px 14px" }}>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 17 }}>
            Sort &amp; Filter {activeCount > 0 && <span style={{ background: "#D3D7DF", color: "#08090B", borderRadius: 999, padding: "2px 9px", fontSize: 12, marginLeft: 6 }}>{activeCount}</span>}
          </div>
          <button onClick={clearAll} style={{ background: "none", border: "none", color: "#FF8B8B", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Clear all</button>
        </div>

        <div style={{ overflowY: "auto", padding: "0 18px 110px", display: "flex", flexDirection: "column", gap: 24 }}>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B6F79", marginBottom: 10, letterSpacing: 1.5 }}>SORT BY</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {SORT_OPTIONS.map(opt => (
                <button key={opt.id} onClick={() => setSort(opt.id)} style={{ background: prefs.sortBy === opt.id ? "#D3D7DF" : "#16171B", color: prefs.sortBy === opt.id ? "#08090B" : "#C9CCD3", border: "none", borderRadius: 14, padding: "12px 6px", cursor: "pointer", fontSize: 12, fontWeight: 700, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, transition: "background 150ms" }}>
                  <span style={{ fontSize: 20 }}>{opt.emoji}</span>{opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B6F79", marginBottom: 10, letterSpacing: 1.5 }}>ROOM TYPE</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ROOM_TYPE_OPTIONS.map(opt => (
                <button key={opt.id} onClick={() => toggle("roomType", opt.id)} style={{ background: prefs.roomType === opt.id ? "#E6E8EC" : "#16171B", color: prefs.roomType === opt.id ? "#060607" : "#C9CCD3", border: "none", borderRadius: 999, padding: "9px 15px", cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                  {opt.emoji} {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B6F79", marginBottom: 10, letterSpacing: 1.5 }}>WALK TIME</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {WALK_OPTIONS.map(opt => (
                <button key={String(opt.id)} onClick={() => setWalk(opt.id)} style={{ background: prefs.walkTime === opt.id ? "#E6E8EC" : "#16171B", color: prefs.walkTime === opt.id ? "#060607" : "#C9CCD3", border: "none", borderRadius: 999, padding: "9px 15px", cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B6F79", marginBottom: 10, letterSpacing: 1.5 }}>CAPACITY</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {CAP_OPTIONS.map(opt => (
                <button key={opt.id} onClick={() => setCap(opt.id)} style={{ background: prefs.capacity === opt.id ? "#E6E8EC" : "#16171B", color: prefs.capacity === opt.id ? "#060607" : "#C9CCD3", border: "none", borderRadius: 999, padding: "9px 15px", cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B6F79", marginBottom: 10, letterSpacing: 1.5 }}>VIBE</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[{v: null, l: "Any"}, {v: "silent", l: "🤫 Silent"}, {v: "quiet", l: "🔇 Quiet-ish"}, {v: "medium", l: "🔉 Background hum"}, {v: "loud", l: "🔊 Chaos energy"}].map(({v, l}) => (
                <button key={String(v)} onClick={() => setPrefs(p => ({ ...p, vibe: p.vibe === v ? null : v }))} style={{ background: prefs.vibe === v ? "#E6E8EC" : "#16171B", color: prefs.vibe === v ? "#060607" : "#C9CCD3", border: "none", borderRadius: 999, padding: "9px 15px", cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6B6F79", marginBottom: 10, letterSpacing: 1.5 }}>MUST HAVE</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[["plug", "⚡ Charging"], ["wifi+", "📶 Wi-Fi+"], ["ac", "❄️ AC"]].map(([tag, label]) => (
                <button key={tag} onClick={() => toggleReq(tag)} style={{ background: prefs.requirements.includes(tag) ? "#D3D7DF" : "#16171B", color: prefs.requirements.includes(tag) ? "#08090B" : "#C9CCD3", border: "none", borderRadius: 999, padding: "9px 15px", cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#16171B", borderRadius: 14, padding: "12px 14px" }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Free rooms only</div>
              <div style={{ fontSize: 11.5, color: "#8B8F99", marginTop: 2 }}>Hide occupied rooms from results</div>
            </div>
            <div onClick={() => setPrefs(p => ({ ...p, freeOnly: !p.freeOnly }))} style={{ width: 46, height: 26, borderRadius: 13, background: prefs.freeOnly ? "#D3D7DF" : "#1E2026", cursor: "pointer", position: "relative", transition: "background 200ms", flexShrink: 0 }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", background: prefs.freeOnly ? "#08090B" : "#F4F5F7", position: "absolute", top: 4, left: prefs.freeOnly ? 24 : 4, transition: "left 200ms" }} />
            </div>
          </div>

        </div>

        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "12px 18px 28px", background: "linear-gradient(transparent, #0E0F12 35%)" }}>
          <button onClick={onClose} style={{ width: "100%", background: "linear-gradient(180deg, #ECEEF2, #B9BEC9)", color: "#08090B", boxShadow: "0 1px 0 rgba(255,255,255,.5) inset, 0 6px 18px rgba(0,0,0,.35)", border: "none", borderRadius: 14, padding: "14px", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif" }}>
            See results
          </button>
        </div>
      </div>
    </>
  );
}

// =========================================================================
// MAIN APP
// =========================================================================
export default function GhostSlot() {
  const [tab, setTab] = useState("find");
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [query, setQuery] = useState("");
  const [understood, setUnderstood] = useState([]);
  const [aiStatus, setAiStatus] = useState("idle"); // idle | loading | gemini | local | error
  const [aiError, setAiError] = useState(null);
  const [matchMyFreeTime, setMatchMyFreeTime] = useState(false);
  const [booking, setBooking] = useState(null); // { roomId, slotId, roomName, secondsLeft }
  const [karma, setKarma] = useState(74);
  const [pinged, setPinged] = useState({});
  const [showNotifs, setShowNotifs] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 800);
  useEffect(() => { const h = () => setWindowWidth(window.innerWidth); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, []);
  const isDesktop = windowWidth >= 768;
  const [toast, setToast] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePw, setDeletePw] = useState("");
  const [deleteErr, setDeleteErr] = useState("");

  // Restore an existing session (httpOnly cookie) and check if AI is on.
  useEffect(() => {
    api("/auth/me").then(({ user }) => setCurrentUser(user)).catch(() => setCurrentUser(null)).finally(() => setAuthChecked(true));
    api("/ai/status").then((r) => setAiConfigured(!!r.configured)).catch(() => setAiConfigured(false));
  }, []);

  // Day/time follow the real IST clock until the user picks one by hand.
  const [clock, setClock] = useState(() => ({ live: true, ...nowIST() }));
  useEffect(() => {
    if (!clock.live) return;
    const tick = () => setClock((c) => {
      if (!c.live) return c;
      const n = nowIST();
      return n.day === c.day && n.time === c.time ? c : { live: true, ...n };
    });
    tick();
    const t = setInterval(tick, 15 * 1000);
    return () => clearInterval(t);
  }, [clock.live]);
  const day = clock.day;
  const time = clock.time;
  const setDay = (d) => setClock((c) => ({ ...c, live: false, day: d }));
  const setTime = (t) => setClock((c) => ({ ...c, live: false, time: t }));
  const goLive = () => setClock({ live: true, ...nowIST() });
  const goDemo = () => setClock({ live: false, day: DEMO_DAY, time: DEMO_TIME });
  const pickerProps = { day, setDay, time, setTime, live: clock.live, onLive: goLive, onDemo: goDemo };
  const [mySlots, setMySlots] = useState(SEED_MY_SLOTS);
  const [roomSlots, setRoomSlots] = useState(SEED_ROOM_SLOTS);
  const [ttSubTab, setTtSubTab] = useState("mine");
  const [myCsvSummary, setMyCsvSummary] = useState(null);
  const [roomCsvSummary, setRoomCsvSummary] = useState(null);

  // Demo Room CSI status — polled from the backend (server/csi.js). Never
  // generated client-side; if the backend is unreachable this simply stays
  // null and the UI shows "CSI status unavailable" rather than inventing a state.
  const [csiStatus, setCsiStatus] = useState(null);
  const [showCsiDevDashboard, setShowCsiDevDashboard] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/csi/status");
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled) setCsiStatus(data);
      } catch {
        if (!cancelled) setCsiStatus(null);
      }
    }
    poll();
    const t = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (!booking) return;
    const t = setInterval(() => {
      setBooking((b) => {
        if (!b) return b;
        if (b.secondsLeft <= 1) {
          clearInterval(t);
          setRoomSlots((rs) => ({ ...rs, [b.roomId]: (rs[b.roomId] || []).filter((s) => s.id !== b.slotId) }));
          setToast("Time's up. Room released automatically. Vacate before the next class catches you red-handed.");
          return null;
        }
        return { ...b, secondsLeft: b.secondsLeft - 1 };
      });
    }, 1000);
    return () => clearInterval(t);
  }, [booking]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  const nowMin = toMin(time);
  const myFreeWindows = useMemo(() => freeWindows(mySlots, day), [mySlots, day]);
  const myAvailableNow = useMemo(() => getAvailableDuration(myFreeWindows, nowMin), [myFreeWindows, nowMin]);

  const roomsWithStatus = useMemo(() => {
    return ROOM_META.map((r) => ({ room: r, status: spaceStatus(r, roomSlots[r.id] || [], day, nowMin) }));
  }, [roomSlots, day, nowMin]);

  // hard filters: capacity, location, roomType, walkTime, freeOnly, "only my free time"
  const hardFiltered = useMemo(() => {
    return roomsWithStatus.filter(({ room, status }) => {
      if (prefs.capacity === 1 && room.capacity > 20) return false;
      if (prefs.capacity === 21 && (room.capacity < 21 || room.capacity > 60)) return false;
      if (prefs.capacity === 61 && room.capacity < 61) return false;
      if (prefs.category && room.category !== prefs.category) return false;
      if (prefs.location && prefs.location !== "Anywhere" && room.block !== prefs.location) return false;
      if (prefs.roomType && room.type !== prefs.roomType) return false;
      if (prefs.walkTime) {
        const walkMin = parseInt((room.walk.match(/\d+/) || [99])[0], 10);
        if (walkMin > prefs.walkTime) return false;
      }
      if (prefs.freeOnly && !status.free) return false;
      if (matchMyFreeTime && myAvailableNow < (prefs.duration || 30)) return false;
      return true;
    });
  }, [roomsWithStatus, prefs, matchMyFreeTime, myAvailableNow]);

  const scoredRooms = useMemo(() => {
    const getWalkMin = r => parseInt((r.walk.match(/\d+/) || [5])[0], 10);
    const scored = hardFiltered.map(({ room, status }) => ({ room, status, ...calculateRoomScore(room, status, prefs) }));
    const sortFns = {
      bestMatch: (a, b) => b.score - a.score,
      freeFirst: (a, b) => (b.status.free ? 1 : 0) - (a.status.free ? 1 : 0) || b.score - a.score,
      nearest: (a, b) => getWalkMin(a.room) - getWalkMin(b.room),
      leastUsed: (a, b) => a.room.util7d - b.room.util7d,
      largest: (a, b) => b.room.capacity - a.room.capacity,
    };
    return scored.sort(sortFns[prefs.sortBy] || sortFns.bestMatch);
  }, [hardFiltered, prefs]);

  const bestMatch = scoredRooms[0] || null;
  const alternatives = scoredRooms.slice(1, 4);
  const restOfList = scoredRooms.slice(1);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (prefs.sortBy && prefs.sortBy !== "bestMatch") n++;
    if (prefs.roomType) n++;
    if (prefs.walkTime) n++;
    if (prefs.capacity > 0) n++;
    if (prefs.vibe) n++;
    if (prefs.requirements.length) n += prefs.requirements.length;
    if (prefs.freeOnly) n++;
    if (prefs.location && prefs.location !== "Anywhere") n++;
    return n;
  }, [prefs]);

  // closest options for the "no match" fallback — score ALL rooms, ignore hard filters
  const closestOptions = useMemo(() => {
    return roomsWithStatus
      .map(({ room, status }) => ({ room, status, ...calculateRoomScore(room, status, prefs) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
  }, [roomsWithStatus, prefs]);

  // dynamic prediction — replaces old hardcoded chart data
  const forecastHours = [10, 11, 12, 13, 14, 15, 16, 17];
  const forecastData = useMemo(
    () => forecastHours.map((h) => ({ hour: hourLabel(h), risk: calculateShortageRisk(h * 60, day, roomSlots) })),
    [day, roomSlots]
  );
  const peakSlot = useMemo(() => forecastData.reduce((max, d) => (d.risk > max.risk ? d : max), forecastData[0]), [forecastData]);
  const underused = useMemo(() => getUnderusedRooms(TIMETABLE_ROOMS, 3), []);
  const avgUtil = useMemo(() => Math.round(TIMETABLE_ROOMS.reduce((a, r) => a + r.util7d, 0) / TIMETABLE_ROOMS.length), []);
  const underusedCount = useMemo(() => TIMETABLE_ROOMS.filter((r) => r.util7d < 25).length, []);

  function applyParsedQuery(parsed) {
    setPrefs((p) => ({
      ...p,
      duration: parsed.duration ?? p.duration,
      location: parsed.location ?? p.location,
      vibe: parsed.vibe ?? p.vibe,
      requirements: parsed.requirements.length ? Array.from(new Set([...p.requirements, ...parsed.requirements])) : p.requirements,
      capacity: parsed.capacity ?? p.capacity,
    }));
    setUnderstood(summarizePrefs({
      duration: parsed.duration ?? prefs.duration,
      location: parsed.location ?? prefs.location,
      vibe: parsed.vibe ?? prefs.vibe,
      requirements: parsed.requirements.length ? parsed.requirements : prefs.requirements,
      capacity: parsed.capacity ?? prefs.capacity,
    }));
  }

  async function runQuery(raw) {
    if (!raw || !raw.trim()) return;

    // No API key configured: go straight to the local parser — same
    // behavior the app had before the API key integration.
    if (!aiConfigured) {
      setAiStatus("local");
      setAiError(null);
      applyParsedQuery(parseNaturalLanguageQuery(raw));
      return;
    }

    setAiStatus("loading");
    setAiError(null);
    try {
      const parsed = await parseQueryWithGemini(raw);
      setAiStatus("gemini");
      applyParsedQuery(parsed);
    } catch (err) {
      // Gemini failed (bad key, network, rate limit, etc.) — fall back to
      // the original rule-based parser so search never just breaks.
      setAiStatus("error");
      setAiError(err.message || "AI request failed");
      applyParsedQuery(parseNaturalLanguageQuery(raw));
    }
  }
  function runDemoQuery() { setQuery(DEMO_QUERY); runQuery(DEMO_QUERY); }
  function toggleRequirement(tag) {
    setPrefs((p) => ({ ...p, requirements: p.requirements.includes(tag) ? p.requirements.filter((r) => r !== tag) : [...p.requirements, tag] }));
  }

  function handleBook(room, status) {
    const duration = Math.max(15, Math.min(prefs.duration || 30, status.freeFor));
    const endMin = nowMin + duration;
    const slotId = `book_${Date.now()}`;
    setRoomSlots((rs) => ({ ...rs, [room.id]: [...(rs[room.id] || []), { id: slotId, day, start: time, end: toHHMM(endMin), subject: "Reserved (you)" }] }));
    setBooking({ roomId: room.id, slotId, roomName: room.name, secondsLeft: duration * 60 });
    setToast(`${room.name} is yours for ${fmtMin(duration)}. Don't ghost it.`);
  }
  function endEarly() {
    if (!booking) return;
    setRoomSlots((rs) => ({ ...rs, [booking.roomId]: (rs[booking.roomId] || []).filter((s) => s.id !== booking.slotId) }));
    setKarma((k) => k + 5);
    setBooking(null);
    setToast("Ended early. +5 room karma — the campus thanks you.");
  }
  function ping(person) { setPinged((p) => ({ ...p, [person]: true })); setToast(`${person} has been pinged. No cap, they'll probably see it eventually.`); }

  function addMySlot(slot) { setMySlots((s) => [...s, slot]); setToast("Added to your timetable. The AI now knows your business."); }
  function removeMySlot(id) { setMySlots((s) => s.filter((x) => x.id !== id)); }
  function addRoomSlot(slot, roomId) { setRoomSlots((rs) => ({ ...rs, [roomId]: [...(rs[roomId] || []), slot] })); setToast("Room timetable updated. One less mystery on campus."); }
  function removeRoomSlot(roomId, id) { setRoomSlots((rs) => ({ ...rs, [roomId]: rs[roomId].filter((x) => x.id !== id) })); }

  function normalizeDay(v) {
    if (!v) return null;
    const map = { mon: "Mon", monday: "Mon", tue: "Tue", tues: "Tue", tuesday: "Tue", wed: "Wed", weds: "Wed", wednesday: "Wed", thu: "Thu", thur: "Thu", thurs: "Thu", thursday: "Thu", fri: "Fri", friday: "Fri", sat: "Sat", saturday: "Sat" };
    const k = String(v).trim().toLowerCase();
    if (map[k]) return map[k];
    const cap = String(v).trim();
    return DAYS.includes(cap) ? cap : null;
  }
  function normalizeTime(v) {
    if (!v) return null;
    const m = String(v).trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = String(Math.min(23, parseInt(m[1], 10))).padStart(2, "0");
    const mm = String(Math.min(59, parseInt(m[2], 10))).padStart(2, "0");
    return `${h}:${mm}`;
  }
  function matchRoom(key) {
    if (!key) return null;
    const k = String(key).trim().toLowerCase().replace(/\s|·/g, "");
    return TIMETABLE_ROOMS.find((r) => r.id.toLowerCase().replace(/\s|·/g, "") === k) || TIMETABLE_ROOMS.find((r) => r.name.toLowerCase().replace(/\s|·/g, "") === k) || null;
  }

  function importMyCSV(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > CSV_MAX_BYTES) { setToast("That CSV is too big (max 256 KB). A timetable doesn't need that much."); e.target.value = ""; return; }
    Papa.parse(file, {
      preview: CSV_MAX_ROWS,
      header: true, skipEmptyLines: true,
      complete: (res) => {
        let added = 0, skipped = 0, conflicts = 0;
        const newSlots = [];
        const running = [...mySlots];
        res.data.forEach((row, i) => {
          const dayV = normalizeDay(row.day || row.Day);
          const start = normalizeTime(row.start || row.Start);
          const end = normalizeTime(row.end || row.End);
          const subject = cleanCell(row.subject || row.Subject || "class") || "class";
          if (!dayV || !start || !end || toMin(end) <= toMin(start)) { skipped++; return; }
          if (hasOverlap(running, dayV, start, end)) { conflicts++; return; }
          const slot = { id: `c${Date.now()}_${i}`, day: dayV, start, end, subject };
          newSlots.push(slot); running.push(slot); added++;
        });
        setMySlots((s) => [...s, ...newSlots]);
        setMyCsvSummary({ added, skipped, conflicts });
        setToast(`Imported ${added} classes${skipped || conflicts ? ` · skipped ${skipped} · conflicts ${conflicts}` : ""}. CSVs > manual typing, no cap.`);
      },
      error: () => setToast("Couldn't read that CSV. Check the format and try again."),
    });
    e.target.value = "";
  }

  function importRoomCSV(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > CSV_MAX_BYTES) { setToast("That CSV is too big (max 256 KB). A timetable doesn't need that much."); e.target.value = ""; return; }
    Papa.parse(file, {
      preview: CSV_MAX_ROWS,
      header: true, skipEmptyLines: true,
      complete: (res) => {
        let added = 0, skipped = 0, conflicts = 0;
        const grouped = {};
        const runningByRoom = {};
        res.data.forEach((row, i) => {
          const room = matchRoom(row.room || row.Room);
          const dayV = normalizeDay(row.day || row.Day);
          const start = normalizeTime(row.start || row.Start);
          const end = normalizeTime(row.end || row.End);
          const subject = cleanCell(row.subject || row.Subject || "class") || "class";
          if (!room || !dayV || !start || !end || toMin(end) <= toMin(start)) { skipped++; return; }
          const running = runningByRoom[room.id] || [...(roomSlots[room.id] || [])];
          if (hasOverlap(running, dayV, start, end)) { conflicts++; return; }
          const slot = { id: `rc${Date.now()}_${i}`, day: dayV, start, end, subject };
          if (!grouped[room.id]) grouped[room.id] = [];
          grouped[room.id].push(slot);
          runningByRoom[room.id] = [...running, slot];
          added++;
        });
        setRoomSlots((rs) => {
          const copy = { ...rs };
          Object.keys(grouped).forEach((rid) => { copy[rid] = [...(copy[rid] || []), ...grouped[rid]]; });
          return copy;
        });
        setRoomCsvSummary({ added, skipped, conflicts });
        setToast(`Imported ${added} room bookings${skipped || conflicts ? ` · skipped ${skipped} · conflicts ${conflicts}` : ""}.`);
      },
      error: () => setToast("Couldn't read that CSV. Check the format and try again."),
    });
    e.target.value = "";
  }

  function downloadTemplate(kind) {
    const csv = kind === "mine"
      ? "day,start,end,subject\nMon,09:00,10:00,DSA\nMon,10:00,11:00,DBMS\n"
      : "room,day,start,end,subject\nA2-104,Mon,09:00,10:30,DBMS\nCSE-Lab-9,Mon,12:00,13:00,AI Lab\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = kind === "mine" ? "my-timetable-template.csv" : "room-timetable-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleAuthed(u, how) {
    setCurrentUser(u);
    setToast(how === "signup" ? `Account made, ${u.name}. Onboarding complete, gatekeeping complete.` : `Welcome back, ${u.name}. Try not to ghost your bookings this time.`);
  }
  async function handleLogout(everywhere = false) {
    try { await api(everywhere ? "/auth/logout-all" : "/auth/logout", { method: "POST" }); } catch { /* session already gone */ }
    setCurrentUser(null); setTab("find"); setBooking(null);
  }
  async function deleteAccount() {
    setDeleteErr("");
    try {
      await api("/auth/delete-account", { method: "POST", body: { password: deletePw } });
      setDeletePw(""); setDeleteOpen(false); setCurrentUser(null); setTab("find"); setBooking(null);
    } catch (e) { setDeleteErr(e.message); }
  }

  // Snapshot of real, current app data for CampusAI — nothing here is
  // invented; it's the same rooms/status/timetable the Find and Timetable
  // tabs already compute, just packaged for the assistant.
  function buildCampusContext() {
    return {
      day,
      time,
      myFreeWindows: myFreeWindows.map(([s, e]) => `${toHHMM(s)}-${toHHMM(e)}`),
      rooms: roomsWithStatus.map(({ room, status }) => ({
        id: room.id,
        name: room.name,
        block: room.block,
        floor: room.floor,
        capacity: room.capacity,
        walk: room.walk,
        vibe: room.vibe,
        tags: room.tags,
        category: room.category,
        bookable: room.bookable !== false,
        crowdPct: typeof status.crowd === "number" && !status.closed ? status.crowd : null,
        closed: !!status.closed,
        free: status.free,
        freeForMin: status.free ? status.freeFor : null,
        busyUntil: status.free ? null : status.busyUntil,
      })),
    };
  }

  // CampusAI's "View Space" action reuses the existing Find tab + filters —
  // there's no free-text search box for room names, so this narrows the
  // location filter to that room's block instead of building a new view.
  function handleViewSpaceFromAI(roomId) {
    const match = ROOM_META.find((r) => r.id === roomId);
    if (!match) return;
    setTab("find");
    setShowFilters(false);
    setPrefs((p) => ({ ...DEFAULT_PREFS, location: match.block, sortBy: p.sortBy }));
  }

  if (!authChecked) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#050506" }}>
        <BrandMark size={48} glow />
      </div>
    );
  }
  if (!currentUser) {
    return <AuthScreen onAuthed={handleAuthed} />;
  }

  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const navItems = [
    { id: "find", label: "Find", icon: Search },
    { id: "map", label: "Map", icon: MapIcon },
    { id: "timetable", label: "Timetable", icon: CalendarClock },
    { id: "predict", label: "Predict", icon: TrendingUp },
    { id: "twin", label: "Twin", icon: Activity },
    { id: "squad", label: "Squad", icon: MessageCircleMore },
    { id: "profile", label: "You", icon: Trophy },
  ];

  return (
    <div className="gs-root" style={{ fontFamily: "'Inter', sans-serif", background: "#060607", minHeight: "100vh", color: "#F4F5F7" }}>
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { display: none; }
        input::placeholder { color: #6B6F79; }
        @keyframes gs-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .gs-spin { animation: gs-spin 0.9s linear infinite; }
        /* ── mobile defaults ── */
        .gs-root { max-width: 460px; margin: 0 auto; padding-bottom: 84px; }
        .gs-sidebar { display: none; }
        .gs-desktop-topbar { display: none; }
        /* ── desktop overrides ── */
        @media (min-width: 768px) {
          .gs-root { max-width: none; margin: 0; padding-bottom: 0; display: flex; height: 100vh; overflow: hidden; }
          .gs-sidebar { display: flex; flex-direction: column; width: 240px; min-width: 240px; background: #08090B; border-right: 1px solid rgba(255,255,255,0.07); height: 100vh; position: sticky; top: 0; overflow-y: auto; }
          .gs-main { flex: 1; min-width: 0; height: 100vh; overflow-y: auto; display: flex; flex-direction: column; }
          .gs-mobile-topbar { display: none !important; }
          .gs-desktop-topbar { display: flex !important; align-items: center; justify-content: space-between; padding: 18px 32px; border-bottom: 1px solid rgba(255,255,255,0.06); position: sticky; top: 0; background: #060607; z-index: 5; flex-shrink: 0; }
          .gs-bottom-nav { display: none !important; }
          .gs-tab-wrap { padding: 0 32px 32px; flex: 1; }
          .gs-room-grid { display: grid !important; grid-template-columns: repeat(2, 1fr) !important; gap: 14px !important; flex-direction: unset !important; }
          .gs-predict-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
          .gs-timetable-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
          .gs-squad-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
        }
      `}</style>

      {/* desktop sidebar */}
      <aside className="gs-sidebar">
        <div style={{ padding: "22px 20px 18px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <BrandMark size={34} />
            <Wordmark size={20} />
          </div>
          <div style={{ fontSize: 10.5, color: "#4A4E57" }}>campus space intelligence</div>
        </div>
        <nav style={{ padding: "14px 12px", flex: 1 }}>
          {navItems.map(n => { const Icon = n.icon; const active = tab === n.id; return (
            <button key={n.id} onClick={() => setTab(n.id)} style={{ width: "100%", background: active ? "rgba(211,215,223,0.15)" : "none", border: active ? "1px solid rgba(211,215,223,0.25)" : "1px solid transparent", borderRadius: 10, padding: "10px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, color: active ? "#E6E8EC" : "#6B6F79", marginBottom: 4, textAlign: "left", transition: "all 150ms" }}>
              <Icon size={17} /><span style={{ fontWeight: 600, fontSize: 13.5 }}>{n.label}</span>
            </button>
          );})}
        </nav>
        <div style={{ padding: "14px 20px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#F4F5F7" }}>{currentUser.name}</div>
          <div style={{ fontSize: 11, color: "#6B6F79", fontFamily: "'JetBrains Mono', monospace", marginBottom: 10 }}>{currentUser.roll}</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <Pill tone="lime"><Flame size={10} style={{ marginRight: 4, verticalAlign: -1 }} />{karma}</Pill>
            <button onClick={() => handleLogout()} style={{ background: "none", border: "none", color: "#FF8B8B", fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}><LogOut size={11} /> logout</button>
          </div>
        </div>
      </aside>
      {/* desktop: gs-main wraps everything else */}
      <div className="gs-main">
      {/* desktop topbar */}
      <div className="gs-desktop-topbar">
        <div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 20 }}>{navItems.find(n => n.id === tab)?.label}</div>
          <div style={{ fontSize: 11.5, color: "#8B8F99", marginTop: 2 }}>AI-powered campus space intelligence · CU</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <TimeDayPicker {...pickerProps} />
          <Pill tone="lime"><Flame size={10} style={{ marginRight: 4, verticalAlign: -1 }} />{karma}</Pill>
          <button onClick={() => setShowNotifs(s => !s)} style={{ background: "#101114", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", position: "relative" }}>
            <Bell size={16} color="#F4F5F7" /><span style={{ position: "absolute", top: -3, right: -3, width: 8, height: 8, borderRadius: 999, background: "#FF6B6B" }} />
          </button>
        </div>
      </div>
      {/* mobile topbar */}
      <div className="gs-mobile-topbar" style={{ padding: "20px 18px 12px", position: "sticky", top: 0, background: "#060607", zIndex: 5 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BrandMark size={34} />
            <Wordmark size={20} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Pill tone="lime"><Flame size={10} style={{ marginRight: 4, verticalAlign: -1 }} />{karma}</Pill>
            <button onClick={() => setShowNotifs((s) => !s)} style={{ background: "#101114", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", position: "relative" }}>
              <Bell size={16} color="#F4F5F7" />
              <span style={{ position: "absolute", top: -3, right: -3, width: 8, height: 8, borderRadius: 999, background: "#FF6B6B" }} />
            </button>
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: "#8B8F99", marginTop: 6, marginBottom: 8 }}>AI-powered campus space intelligence — not just a room directory.</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {[["Search", "tell us what you need"], ["Match", "AI finds the best space"], ["Optimize", "CU spots unused capacity"]].map(([t, sub], i) => (
            <div key={t} style={{ flex: 1, background: "#101114", borderRadius: 10, padding: "6px 8px", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#E6E8EC" }}>{i + 1}. {t}</div>
              <div style={{ fontSize: 9.5, color: "#6B6F79" }}>{sub}</div>
            </div>
          ))}
        </div>
        <TimeDayPicker {...pickerProps} />
      </div>{/* end gs-mobile-topbar */}

      {showNotifs && (
        <div style={{ margin: "0 18px 10px", background: "#101114", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {NOTIFS.map((n) => (
            <div key={n.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <Sparkles size={13} color="#E6E8EC" style={{ marginTop: 2, flexShrink: 0 }} />
              <div><div style={{ fontSize: 13, lineHeight: 1.4 }}>{n.text}</div><div style={{ fontSize: 10.5, color: "#6B6F79", marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>{n.time}</div></div>
            </div>
          ))}
        </div>
      )}

      {booking && (
        <div style={{ margin: "0 18px 14px", background: "linear-gradient(180deg, #ECEEF2, #B9BEC9)", color: "#08090B", boxShadow: "0 1px 0 rgba(255,255,255,.5) inset, 0 10px 30px rgba(0,0,0,.45)", borderRadius: 16, padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(8,9,11,0.6)", fontFamily: "'JetBrains Mono', monospace" }}>RESERVED BY YOU</div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 15 }}>{booking.roomName}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, fontWeight: 500 }}>{fmt(booking.secondsLeft)}</div>
            <button onClick={endEarly} style={{ marginTop: 4, fontSize: 11, background: "#08090B", border: "none", color: "#F4F5F7", borderRadius: 8, padding: "4px 8px", cursor: "pointer" }}>I'm out</button>
          </div>
        </div>
      )}

      <div className="gs-tab-wrap">
      {tab === "find" && (
        <div style={{ padding: "0 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          <GhostSlotInfo />

          <div style={{ background: "#101114", border: "1px solid rgba(211,215,223,0.3)", borderRadius: 16, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: "#C9CDD6" }}>
                <Wand2 size={13} /> AI-assisted room search
              </div>
              {aiConfigured ? (
                <Pill tone={aiStatus === "error" ? "coral" : "lime"}>
                  {aiStatus === "loading" ? "thinking…" : aiStatus === "error" ? "fallback: local parser" : "Gemini-powered"}
                </Pill>
              ) : (
                <Pill>local parser</Pill>
              )}
            </div>
            <div style={{ position: "relative" }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runQuery(query); }}
                placeholder="e.g. quiet place near CSE for 90 minutes with charging"
                disabled={aiStatus === "loading"}
                style={{ width: "100%", background: "#060607", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "11px 46px 11px 12px", color: "#F4F5F7", fontSize: 13, outline: "none", opacity: aiStatus === "loading" ? 0.6 : 1 }}
              />
              <button onClick={() => runQuery(query)} disabled={aiStatus === "loading"} style={{ position: "absolute", right: 6, top: 6, background: "#D3D7DF", border: "none", borderRadius: 8, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: aiStatus === "loading" ? "default" : "pointer" }}>
                {aiStatus === "loading" ? <RefreshCw size={14} color="#060607" className="gs-spin" /> : <ArrowRight size={14} color="#060607" />}
              </button>
            </div>
            <button onClick={runDemoQuery} style={{ alignSelf: "flex-start", background: "none", border: "none", color: "#6B6F79", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
              <Sparkle size={11} /> Try: "{DEMO_QUERY}"
            </button>
            {understood.length > 0 && (
              <div style={{ fontSize: 11.5, color: "#E6E8EC", background: "rgba(211,215,223,0.08)", borderRadius: 10, padding: "8px 10px" }}>
                <b>AI understood:</b> {understood.join(" · ")}
              </div>
            )}
            {aiStatus === "error" && aiError && (
              <div style={{ fontSize: 11, color: "#FF8B8B", background: "rgba(255,107,107,0.08)", borderRadius: 10, padding: "8px 10px" }}>
                Gemini request failed ({aiError}) — used the built-in parser instead.
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
            {CATEGORIES.map((c) => (
              <button key={String(c.id)} onClick={() => setPrefs((p) => ({ ...p, category: c.id }))} style={{ flexShrink: 0, background: prefs.category === c.id ? "#E6E8EC" : "#101114", color: prefs.category === c.id ? "#060607" : "#F4F5F7", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 999, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                {c.label}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
            {DURATION_PRESETS.map((d) => (
              <button key={d} onClick={() => setPrefs((p) => ({ ...p, duration: d }))} style={{ flexShrink: 0, background: prefs.duration === d ? "#D3D7DF" : "#101114", color: prefs.duration === d ? "#08090B" : "#F4F5F7", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                {d} min
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
            {LOCATIONS.map((loc) => (
              <button key={loc} onClick={() => setPrefs((p) => ({ ...p, location: loc }))} style={{ flexShrink: 0, background: prefs.location === loc ? "#E6E8EC" : "#101114", color: prefs.location === loc ? "#060607" : "#F4F5F7", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                <Building2 size={11} /> {loc === "Anywhere" ? "Anywhere" : `Near ${loc.replace(" Block", "").replace("Central ", "")}`}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
            <button onClick={() => setMatchMyFreeTime((q) => !q)} style={{ flexShrink: 0, background: matchMyFreeTime ? "#D3D7DF" : "#101114", color: matchMyFreeTime ? "#08090B" : "#F4F5F7", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 999, padding: "7px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              <CalendarClock size={11} style={{ marginRight: 4, verticalAlign: -2 }} />my free time
            </button>
            <button onClick={() => setPrefs((p) => ({ ...p, vibe: p.vibe === "quiet" ? null : "quiet" }))} style={{ flexShrink: 0, background: prefs.vibe === "quiet" ? "#E6E8EC" : "#101114", color: prefs.vibe === "quiet" ? "#060607" : "#F4F5F7", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 999, padding: "7px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              <Snowflake size={11} style={{ marginRight: 4, verticalAlign: -2 }} />quiet
            </button>
            {[["plug", "charging"], ["wifi+", "wi-fi"]].map(([tag, label]) => (
              <button key={tag} onClick={() => toggleRequirement(tag)} style={{ flexShrink: 0, background: prefs.requirements.includes(tag) ? "#E6E8EC" : "#101114", color: prefs.requirements.includes(tag) ? "#060607" : "#F4F5F7", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 999, padding: "7px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                {label}
              </button>
            ))}
            <button onClick={() => setShowFilters(true)} style={{ flexShrink: 0, marginLeft: "auto", background: activeFilterCount > 0 ? "#D3D7DF" : "#16171B", color: activeFilterCount > 0 ? "#08090B" : "#C9CCD3", border: activeFilterCount > 0 ? "none" : "1px solid rgba(255,255,255,0.12)", borderRadius: 999, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
              <Sparkles size={13} />
              {activeFilterCount > 0 ? `Filters (${activeFilterCount})` : "Sort & Filter"}
            </button>
          </div>

          {showFilters && (
            <FiltersPanel
              prefs={prefs}
              setPrefs={setPrefs}
              onClose={() => setShowFilters(false)}
              activeCount={activeFilterCount}
            />
          )}

          {showCsiDevDashboard && (
            <CsiDevDashboard csi={csiStatus} onClose={() => setShowCsiDevDashboard(false)} />
          )}

          {matchMyFreeTime && myAvailableNow < (prefs.duration || 30) && (
            <div style={{ fontSize: 12, color: "#FF8B8B", background: "rgba(255,107,107,0.08)", borderRadius: 12, padding: 10 }}>
              You only have {fmtMin(myAvailableNow)} free right now per your timetable — that's short of your {prefs.duration || 30} min ask.
            </div>
          )}

          {bestMatch ? (
            <div style={{ background: "linear-gradient(180deg, #17181D, #0E0F12)", border: "1px solid rgba(211,215,223,0.35)", borderRadius: 18, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#E6E8EC", display: "flex", alignItems: "center", gap: 4 }}>
                  <Sparkles size={13} /> BEST MATCH
                </div>
                <Pill tone="lime">{bestMatch.score}% match</Pill>
              </div>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 19 }}>{bestMatch.room.name}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {getRecommendationExplanation(bestMatch.room, bestMatch.status, prefs).map((line, i) => (
                  <div key={i} style={{ fontSize: 12.5, color: "#C9CCD3", display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <CheckCircle2 size={13} color="#E6E8EC" style={{ marginTop: 1, flexShrink: 0 }} /> {line}
                  </div>
                ))}
              </div>
              {bestMatch.room.bookable !== false && bestMatch.status.free && !(booking && booking.roomId === bestMatch.room.id) && (
                <button onClick={() => handleBook(bestMatch.room, bestMatch.status)} disabled={!!booking} style={{ background: booking ? "rgba(255,255,255,0.06)" : "#D3D7DF", color: booking ? "#6B6F79" : "#060607", border: "none", borderRadius: 12, padding: "11px 14px", fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, cursor: booking ? "not-allowed" : "pointer" }}>
                  {booking ? "end current booking first" : "Lock it in"}
                </button>
              )}
            </div>
          ) : (
            <div style={{ background: "#101114", border: "1px solid rgba(255,107,107,0.3)", borderRadius: 16, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <AlertTriangle size={16} color="#FF8B8B" style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 12.5, color: "#C9CCD3" }}>No room matches everything you asked for right now. Closest options:</div>
              </div>
              {closestOptions.map(({ room, status, score }) => (
                <div key={room.id} style={{ background: "#16171B", borderRadius: 12, padding: 10, fontSize: 12, color: "#C9CCD3" }}>
                  <b>{room.name}</b> — {score}% match, {status.free ? `free for ${fmtMin(status.freeFor)}` : status.closed ? `closed until ${status.busyUntil}` : `busy until ${status.busyUntil}`}, {room.walk}
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {prefs.location !== "Anywhere" && (
                  <button onClick={() => setPrefs((p) => ({ ...p, location: "Anywhere" }))} style={{ background: "#D3D7DF", color: "#060607", border: "none", borderRadius: 999, padding: "6px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Expand location</button>
                )}
                {prefs.vibe && (
                  <button onClick={() => setPrefs((p) => ({ ...p, vibe: null }))} style={{ background: "#D3D7DF", color: "#060607", border: "none", borderRadius: 999, padding: "6px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Remove vibe filter</button>
                )}
                {prefs.duration > 30 && (
                  <button onClick={() => setPrefs((p) => ({ ...p, duration: Math.max(30, p.duration - 30) }))} style={{ background: "#D3D7DF", color: "#060607", border: "none", borderRadius: 999, padding: "6px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
                    <RefreshCw size={10} style={{ marginRight: 4, verticalAlign: -1 }} />Allow {Math.max(30, prefs.duration - 30)} min
                  </button>
                )}
                {matchMyFreeTime && (
                  <button onClick={() => setMatchMyFreeTime(false)} style={{ background: "#D3D7DF", color: "#060607", border: "none", borderRadius: 999, padding: "6px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Ignore my free time</button>
                )}
              </div>
            </div>
          )}

          {alternatives.length > 0 && (
            <div>
              <div style={{ fontSize: 11.5, color: "#6B6F79", fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>OTHER GOOD OPTIONS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {alternatives.map(({ room, status, score }) => (
                  <div key={room.id} style={{ background: "#101114", borderRadius: 12, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{room.name}</div>
                      <div style={{ fontSize: 11, color: "#6B6F79" }}>{room.sensing === "wifi" ? statusMeta(room, status, prefs, null).label : status.free ? `free ${fmtMin(status.freeFor)}` : status.closed ? `closed till ${status.busyUntil}` : `busy till ${status.busyUntil}`} · {room.walk}</div>
                    </div>
                    <Pill tone="lime">{score}%</Pill>
                  </div>
                ))}
              </div>
            </div>
          )}

          {restOfList.length > 0 && (
            <div className="gs-room-grid" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 11.5, color: "#6B6F79", fontFamily: "'JetBrains Mono', monospace", gridColumn: "1 / -1" }}>ALL ROOMS</div>
              {restOfList.map(({ room, status, score }) => (
                <RoomCard key={room.id} room={room} status={status} prefs={prefs} booking={booking} onBook={handleBook} hasActiveBooking={!!booking} scoreBadge={score} csi={room.csiEnabled ? csiStatus : undefined} onOpenDevDashboard={room.csiEnabled ? () => setShowCsiDevDashboard(true) : undefined} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "map" && (
        <div style={{ padding: "0 18px" }}>
          <CampusMap
            rooms={roomsWithStatus}
            booking={booking}
            csi={csiStatus}
            onBook={handleBook}
            onShowInFind={(room) => { setTab("find"); setPrefs((p) => ({ ...DEFAULT_PREFS, category: room.category, sortBy: p.sortBy })); }}
          />
        </div>
      )}

      {tab === "timetable" && (
        <div style={{ padding: "0 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setTtSubTab("mine")} style={{ flex: 1, background: ttSubTab === "mine" ? "#D3D7DF" : "#101114", color: ttSubTab === "mine" ? "#08090B" : "#8B8F99", border: "none", borderRadius: 12, padding: "9px 0", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>My timetable</button>
            <button onClick={() => setTtSubTab("rooms")} style={{ flex: 1, background: ttSubTab === "rooms" ? "#D3D7DF" : "#101114", color: ttSubTab === "rooms" ? "#08090B" : "#8B8F99", border: "none", borderRadius: 12, padding: "9px 0", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>Room timetables</button>
          </div>

          {ttSubTab === "mine" && (
            <>
              <div style={{ fontSize: 12.5, color: "#8B8F99" }}>Feed it your classes so it stops guessing when you're actually free.</div>
              <CsvImport
                label="Bulk import your timetable"
                hint="CSV columns: day, start, end, subject. Times as HH:MM, 24-hour."
                onFile={importMyCSV}
                onTemplate={() => downloadTemplate("mine")}
                summary={myCsvSummary}
              />
              <div style={{ textAlign: "center", fontSize: 10.5, color: "#4A4E57" }}>— or add one manually —</div>
              <SlotForm day={day} onAdd={addMySlot} roomOptions={null} existingSlotsFor={() => mySlots} />
              <div style={{ fontSize: 11.5, color: "#6B6F79", fontFamily: "'JetBrains Mono', monospace" }}>{day.toUpperCase()}'S CLASSES</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {mySlots.filter((s) => s.day === day).sort((a, b) => toMin(a.start) - toMin(b.start)).map((s) => (
                  <div key={s.id} style={{ background: "#101114", borderRadius: 12, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div><div style={{ fontSize: 13, fontWeight: 600 }}>{s.subject}</div><div style={{ fontSize: 11.5, color: "#6B6F79", fontFamily: "'JetBrains Mono', monospace" }}>{s.start}–{s.end}</div></div>
                    <button onClick={() => removeMySlot(s.id)} style={{ background: "none", border: "none", cursor: "pointer" }}><Trash2 size={14} color="#6B6F79" /></button>
                  </div>
                ))}
                {mySlots.filter((s) => s.day === day).length === 0 && <div style={{ fontSize: 12.5, color: "#6B6F79" }}>No classes logged for {day}. Free bird.</div>}
              </div>
              <div style={{ fontSize: 11.5, color: "#6B6F79", fontFamily: "'JetBrains Mono', monospace", marginTop: 4 }}>YOUR FREE WINDOWS</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {myFreeWindows.length ? myFreeWindows.map(([s, e], i) => <Pill key={i} tone="lime">{toHHMM(s)}–{toHHMM(e)}</Pill>) : <span style={{ fontSize: 12.5, color: "#6B6F79" }}>Booked solid. Rough day.</span>}
              </div>
            </>
          )}

          {ttSubTab === "rooms" && (
            <>
              <div style={{ fontSize: 12.5, color: "#8B8F99" }}>Log what a room's booked for and GhostSlot figures out the rest.</div>
              <CsvImport
                label="Bulk import room timetables"
                hint="CSV columns: room, day, start, end, subject. Room = exact room ID or name, e.g. A2-104."
                onFile={importRoomCSV}
                onTemplate={() => downloadTemplate("rooms")}
                summary={roomCsvSummary}
              />
              <div style={{ textAlign: "center", fontSize: 10.5, color: "#4A4E57" }}>— or add one manually —</div>
              <SlotForm day={day} onAdd={addRoomSlot} roomOptions={TIMETABLE_ROOMS} existingSlotsFor={(roomId) => roomSlots[roomId] || []} />
              {TIMETABLE_ROOMS.map((r) => (
                <div key={r.id}>
                  <div style={{ fontSize: 11.5, color: "#6B6F79", fontFamily: "'JetBrains Mono', monospace", marginTop: 6, marginBottom: 4 }}>{r.name.toUpperCase()} · {day.toUpperCase()}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {(roomSlots[r.id] || []).filter((s) => s.day === day).sort((a, b) => toMin(a.start) - toMin(b.start)).map((s) => (
                      <div key={s.id} style={{ background: "#101114", borderRadius: 12, padding: "9px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div><div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.subject}</div><div style={{ fontSize: 11, color: "#6B6F79", fontFamily: "'JetBrains Mono', monospace" }}>{s.start}–{s.end}</div></div>
                        <button onClick={() => removeRoomSlot(r.id, s.id)} style={{ background: "none", border: "none", cursor: "pointer" }}><Trash2 size={13} color="#6B6F79" /></button>
                      </div>
                    ))}
                    {(roomSlots[r.id] || []).filter((s) => s.day === day).length === 0 && <div style={{ fontSize: 12, color: "#4A4E57" }}>nothing booked — open all {day}</div>}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {tab === "predict" && (
        <div style={{ padding: "0 18px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16 }}>AI-assisted shortage forecast</div>
            <div style={{ fontSize: 12, color: "#8B8F99", marginTop: 2 }}>Forecast combines timetable occupancy, historical utilization and current demand signals.</div>
          </div>
          <div style={{ background: "#101114", borderRadius: 16, padding: 12, height: 190 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={forecastData} margin={{ top: 5, right: 8, left: -22, bottom: 0 }}>
                <defs><linearGradient id="riskFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#D3D7DF" stopOpacity={0.6} /><stop offset="100%" stopColor="#D3D7DF" stopOpacity={0.02} /></linearGradient></defs>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="hour" tick={{ fill: "#6B6F79", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#6B6F79", fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
                <Tooltip contentStyle={{ background: "#060607", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12 }} />
                <Area type="monotone" dataKey="risk" stroke="#D3D7DF" strokeWidth={2} fill="url(#riskFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div style={{ background: "#101114", border: "1px solid rgba(255,107,107,0.25)", borderRadius: 14, padding: 12, fontSize: 12.5, color: "#C9CCD3", display: "flex", gap: 8 }}>
            <Sparkles size={16} color="#FF8B8B" style={{ flexShrink: 0 }} />
            <span><b style={{ color: "#FF8B8B" }}>{peakSlot.hour} is about to be a bloodbath</b> — {peakSlot.risk}% shortage risk. Book your spot before then or accept your fate on the canteen steps.</span>
          </div>

          <div style={{ background: "#101114", borderRadius: 16, padding: 14, border: "1px solid rgba(255,255,255,0.07)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#E6E8EC", fontFamily: "'JetBrains Mono', monospace", marginBottom: 10 }}>CAMPUS CAPACITY</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <div style={{ flex: "1 1 40%" }}><div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{TIMETABLE_ROOMS.length}</div><div style={{ fontSize: 10.5, color: "#8B8F99" }}>rooms tracked</div></div>
              <div style={{ flex: "1 1 40%" }}><div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{avgUtil}%</div><div style={{ fontSize: 10.5, color: "#8B8F99" }}>avg utilization</div></div>
              <div style={{ flex: "1 1 40%" }}><div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{underusedCount}</div><div style={{ fontSize: 10.5, color: "#8B8F99" }}>underused rooms</div></div>
              <div style={{ flex: "1 1 40%" }}><div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{peakSlot.hour}</div><div style={{ fontSize: 10.5, color: "#8B8F99" }}>peak shortage</div></div>
            </div>
            <div style={{ fontSize: 12, color: "#C9CCD3", marginTop: 10, lineHeight: 1.4 }}>
              <Percent size={11} style={{ marginRight: 4, verticalAlign: -1 }} color="#E6E8EC" />
              <b style={{ color: "#E6E8EC" }}>{100 - avgUtil}%</b> of tracked room-capacity sits unused in an average week. Use what's already built before asking for more.
            </div>
          </div>

          <div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16 }}>Most ghosted rooms</div>
            <div style={{ fontSize: 12, color: "#8B8F99", marginTop: 2, marginBottom: 8 }}>These spaces have capacity that's frequently left unused.</div>
            <div style={{ background: "#101114", borderRadius: 16, padding: 12, height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={underused} layout="vertical" margin={{ left: 6, right: 16 }}>
                  <XAxis type="number" hide domain={[0, 100]} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "#C9CCD3", fontSize: 11 }} axisLine={false} tickLine={false} width={110} />
                  <Tooltip contentStyle={{ background: "#060607", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12 }} />
                  <Bar dataKey="util" radius={[0, 6, 6, 0]} barSize={16}>{underused.map((_, i) => <Cell key={i} fill="#E6E8EC" />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {tab === "twin" && <Twin />}

      {tab === "squad" && (
        <div style={{ padding: "0 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12.5, color: "#8B8F99" }}>People in your batch who are also free right now, allegedly.</div>
          {SQUAD.map((s) => (
            <div key={s.name} style={{ background: "#101114", borderRadius: 16, padding: 13, display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: "#1E2026", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 13, color: "#C9CDD6" }}>{s.init}</div>
                <div><div style={{ fontWeight: 600, fontSize: 13.5 }}>{s.name}</div><div style={{ fontSize: 11.5, color: "#6B6F79" }}>{s.free} · {s.slot}</div></div>
              </div>
              <button onClick={() => ping(s.name)} disabled={pinged[s.name]} style={{ background: pinged[s.name] ? "rgba(211,215,223,0.15)" : "#D3D7DF", color: pinged[s.name] ? "#E6E8EC" : "#060607", border: "none", borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: pinged[s.name] ? "default" : "pointer" }}>
                {pinged[s.name] ? "pinged ✓" : "ping"}
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "profile" && (
        <div style={{ padding: "0 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 17 }}>{currentUser.name}</div>
              <div style={{ fontSize: 11.5, color: "#6B6F79", fontFamily: "'JetBrains Mono', monospace" }}>{currentUser.roll}</div>
            </div>
            <button onClick={() => handleLogout()} style={{ background: "#101114", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "8px 10px", display: "flex", alignItems: "center", gap: 5, color: "#FF8B8B", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <LogOut size={13} /> logout
            </button>
          </div>
          <div style={{ background: "linear-gradient(180deg, #1A1B20, #0E0F12)", borderRadius: 18, padding: 18, border: "1px solid rgba(255,255,255,0.07)" }}>
            <div style={{ fontSize: 11.5, color: "#8B8F99", fontFamily: "'JetBrains Mono', monospace" }}>ROOM KARMA</div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 34, fontWeight: 700, color: "#E6E8EC" }}>{karma}</div>
            <div style={{ fontSize: 12, color: "#8B8F99", marginTop: 2 }}>Top 12% of students who actually leave on time.</div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1, background: "#101114", borderRadius: 14, padding: 12, border: "1px solid rgba(255,255,255,0.07)" }}>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{mySlots.length}</div>
              <div style={{ fontSize: 11, color: "#8B8F99" }}>classes logged</div>
            </div>
            <div style={{ flex: 1, background: "#101114", borderRadius: 14, padding: 12, border: "1px solid rgba(255,255,255,0.07)" }}>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>1</div>
              <div style={{ fontSize: 11, color: "#8B8F99" }}>ghosted booking (we see you)</div>
            </div>
          </div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 15 }}>Badges</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Pill tone="lime"><CheckCircle2 size={10} style={{ marginRight: 4, verticalAlign: -1 }} />early checkout x5</Pill>
            <Pill><Radar size={10} style={{ marginRight: 4, verticalAlign: -1 }} />library regular</Pill>
            <Pill tone="coral"><Flame size={10} style={{ marginRight: 4, verticalAlign: -1 }} />1pm survivor</Pill>
          </div>

          {/* Security & privacy — what we hold about you, and the controls */}
          <div style={{ background: "linear-gradient(180deg, #17181D, #0E0F12)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 18, padding: 16, display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 1px 0 rgba(255,255,255,.04) inset" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 12, background: "linear-gradient(180deg, #ECEEF2, #B9BEC9)", display: "flex", alignItems: "center", justifyContent: "center" }}><ShieldCheck size={18} color="#08090B" /></div>
              <div>
                <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 15 }}>Security &amp; privacy</div>
                <div style={{ fontSize: 11.5, color: "#8B8F99" }}>What GhostSlot holds about you, and your controls.</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ background: "rgba(61,220,151,0.08)", border: "1px solid rgba(61,220,151,0.22)", borderRadius: 12, padding: "10px 12px" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#3DDC97", display: "flex", alignItems: "center", gap: 5 }}><CheckCircle2 size={13} /> 18+ verified</div>
                <div style={{ fontSize: 11, color: "#8B8F99", marginTop: 3 }}>at signup{currentUser.ageCheckedAt ? ` · ${new Date(currentUser.ageCheckedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}` : ""}. Birth date not stored.</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "10px 12px" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}><MonitorSmartphone size={13} /> {currentUser.activeSessions || 1} active session{(currentUser.activeSessions || 1) === 1 ? "" : "s"}</div>
                <div style={{ fontSize: 11, color: "#8B8F99", marginTop: 3 }}>Secure httpOnly cookie, ends after 7 days.</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => handleLogout(true)} style={{ background: "#16171B", border: "1px solid #2E3138", color: "#F4F5F7", borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}><LogOut size={13} /> Sign out everywhere</button>
              <button onClick={() => setShowPrivacy(true)} style={{ background: "#16171B", border: "1px solid #2E3138", color: "#F4F5F7", borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}><Info size={13} /> Privacy notice</button>
              <button onClick={() => { setDeleteOpen((o) => !o); setDeleteErr(""); }} style={{ background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.25)", color: "#FF8B8B", borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}><Trash2 size={13} /> Delete my account</button>
            </div>
            {deleteOpen && (
              <div style={{ background: "rgba(255,107,107,0.06)", border: "1px solid rgba(255,107,107,0.2)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 12.5, color: "#C9CCD3" }}>This permanently deletes your account and signs you out on every device. Enter your password to confirm.</div>
                <input type="password" autoComplete="current-password" value={deletePw} onChange={(e) => setDeletePw(e.target.value)} placeholder="password" maxLength={128} style={{ background: "#0A0B0D", border: "1px solid #2E3138", borderRadius: 10, padding: "9px 10px", color: "#F4F5F7", fontSize: 13, outline: "none" }} />
                {deleteErr && <div role="alert" style={{ fontSize: 12, color: "#FF8B8B" }}>{deleteErr}</div>}
                <button onClick={deleteAccount} disabled={!deletePw} style={{ background: "#FF6B6B", color: "#08090B", border: "none", borderRadius: 10, padding: "9px 12px", fontSize: 12.5, fontWeight: 700, cursor: deletePw ? "pointer" : "not-allowed", opacity: deletePw ? 1 : 0.5 }}>Delete permanently</button>
              </div>
            )}
          </div>
        </div>
      )}

      </div>{/* end gs-tab-wrap */}

      {toast && (
        <div style={{ position: "fixed", bottom: 92, left: "50%", transform: "translateX(-50%)", maxWidth: 400, width: "calc(100% - 36px)", background: "#16171B", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: "10px 14px", fontSize: 12.5, display: "flex", alignItems: "center", gap: 8, zIndex: 20, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
          <Sparkles size={13} color="#E6E8EC" style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{toast}</span>
          <button onClick={() => setToast(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={13} color="#6B6F79" /></button>
        </div>
      )}

      </div>{/* end gs-main */}

      <CampusAI buildContext={buildCampusContext} onViewSpace={handleViewSpaceFromAI} />
      {showPrivacy && <PrivacyNotice onClose={() => setShowPrivacy(false)} />}

      <nav className="gs-bottom-nav" style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 460, background: "#0E0F12", borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", padding: "10px 4px 14px", zIndex: 10 }}>
        {navItems.map((n) => {
          const Icon = n.icon;
          const active = tab === n.id;
          return (
            <button key={n.id} onClick={() => setTab(n.id)} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, color: active ? "#E6E8EC" : "#6B6F79" }}>
              <Icon size={18} />
              <span style={{ fontSize: 9.5, fontWeight: 600 }}>{n.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
