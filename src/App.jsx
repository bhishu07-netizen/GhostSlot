import React, { useState, useEffect, useMemo, useRef, lazy, Suspense } from "react";
import { MeshRadar, MeshDevRows, useMeshStatus } from "./MeshRadar.jsx";
import { DoorCounter, useDoorStatus } from "./DoorCounter.jsx";
import Papa from "papaparse";
import {
  MapPin, Clock, Users, TrendingUp, Bell, Plug, Volume1,
  VolumeX, Search, ChevronRight, Sparkles, Trophy, Snowflake, X,
  CheckCircle2, Radar, Flame, MessageCircleMore, CalendarClock, Plus, Trash2,
  LogOut, Upload, Download, FileWarning,
  Info, Wand2, AlertTriangle, Building2, Sparkle, ArrowRight, RefreshCw, Wifi, Percent,
  ShieldCheck, MonitorSmartphone, Map as MapIcon, Activity, BookOpen, Wrench, UserRound, ClipboardCheck, Navigation, WifiOff, QrCode, ScanLine,
} from "lucide-react";
import AuthScreen from "./auth/AuthScreen";
import PrivacyNotice from "./auth/PrivacyNotice";
import { ROLE_META, ROLE_NOTIFS } from "./auth/roles";
import { BrandMark, Wordmark } from "./brand/BrandMark";
import { api } from "./api";
import { StaffWorkLog } from "./roles/StaffWorkLog";
import { CAMPUS_SPACES, ROOM_POSITIONS, CATEGORIES, wifiStatus, crowdLabel } from "./campus";
import WhereAmI from "./WhereAmI";
import ErrorBoundary from "./ErrorBoundary";
import { placeList, findPlace, walkMinutes, walkLabel, loadLocation, saveLocation } from "./location";
import { loadState, saveState, clearState, cleanSlots, cleanRoomSlots } from "./persist";

// Heavier screens load only when opened, so the first screen appears faster.
const CampusAI = lazy(() => import("./CampusAI"));
const CampusMap = lazy(() => import("./CampusMap"));
const Twin = lazy(() => import("./Twin"));
const FacultyHome = lazy(() => import("./roles/FacultyHome"));
const OpsHome = lazy(() => import("./roles/OpsHome"));
const ForecastChart = lazy(() => import("./charts/PredictCharts").then((m) => ({ default: m.ForecastChart })));
const UnderusedChart = lazy(() => import("./charts/PredictCharts").then((m) => ({ default: m.UnderusedChart })));
const DoorQrCodes = lazy(() => import("./MapTools").then((m) => ({ default: m.DoorQrCodes })));
const CheckInQr = lazy(() => import("./CheckInQr"));
const QrScanner = lazy(() => import("./QrScanner"));
const GpsCalibration = lazy(() => import("./MapTools").then((m) => ({ default: m.GpsCalibration })));
function ScreenLoading() {
  return <div role="status" style={{ margin: "0 18px", padding: 18, borderRadius: 16, background: "#120F1E", border: "1px solid rgba(196,181,253,0.14)", color: "#A39CC4", fontSize: 13 }}>Loading…</div>;
}

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
// Demo faculty's teaching timetable: the same classes the room timetables
// above already show, so "my classes" and room status agree.
const SEED_TEACHING_SLOTS = everyWeekday([
  { id: "t1", day: "Mon", start: "09:00", end: "10:30", subject: "DBMS · A2 · 104" },
  { id: "t2", day: "Mon", start: "12:00", end: "13:00", subject: "OS Lab · A2 · 104" },
  { id: "t3", day: "Mon", start: "15:00", end: "16:00", subject: "AI Lab · CSE Lab 9" },
]);
// Each role gets its own app: first tab is its home.
const ROLE_TABS = {
  student: [
    { id: "find", label: "Find", icon: Search },
    { id: "map", label: "Map", icon: MapIcon },
    { id: "timetable", label: "Timetable", icon: CalendarClock },
    { id: "predict", label: "Predict", icon: TrendingUp },
    { id: "twin", label: "Campus", icon: Activity },
    { id: "squad", label: "Squad", icon: MessageCircleMore },
    { id: "profile", label: "You", icon: Trophy },
  ],
  faculty: [
    { id: "classes", label: "My classes", icon: BookOpen },
    { id: "map", label: "Map", icon: MapIcon },
    { id: "timetable", label: "Timetable", icon: CalendarClock },
    { id: "twin", label: "Campus", icon: Activity },
    { id: "profile", label: "Profile", icon: UserRound },
  ],
  facilities: [
    { id: "ops", label: "Operations", icon: Wrench },
    { id: "map", label: "Map", icon: MapIcon },
    { id: "twin", label: "Analytics", icon: Activity },
    { id: "profile", label: "Profile", icon: UserRound },
  ],
};

const FRESH_STATS = { ghosted: 0, early: 0, onTime: 0 };
const DEMO_STATS = { ghosted: 1, early: 5, onTime: 0 };
function cleanStats(x) {
  if (!x || typeof x !== "object") return null;
  const n = (v) => (Number.isInteger(v) && v >= 0 && v < 100000 ? v : 0);
  return { ghosted: n(x.ghosted), early: n(x.early), onTime: n(x.onTime) };
}
const SQUAD = [
  { name: "Ishaan", init: "IS", free: "free till 1:40", slot: "same as you" },
  { name: "Meher", init: "MH", free: "free till 2:00", slot: "same as you" },
  { name: "Devansh", init: "DV", free: "free in 20 min", slot: "next period" },
];


const vibeMeta = {
  silent: { icon: VolumeX, label: "silent zone", color: "#D2C8F5" },
  quiet: { icon: VolumeX, label: "quiet-ish", color: "#C4B5FD" },
  medium: { icon: Volume1, label: "background hum", color: "#E9E3FF" },
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
  // With a real "you are here", distance spans up to ~15 min and counts more.
  const baseDistance = room.walkFromYou ? Math.max(0, 1 - (walkMin - 1) / 14) : Math.max(0, 1 - (walkMin - 1) / 9);
  let distanceScore = baseDistance;
  if (prefs.location && prefs.location !== "Anywhere") distanceScore = room.block === prefs.location ? 1 : 0.15;

  let vibeScore = 1;
  if (prefs.vibe) vibeScore = (VIBE_EQUIVALENTS[prefs.vibe] || [prefs.vibe]).includes(room.vibe) ? 1 : 0.25;

  const utilScore = Math.max(0, 1 - (typeof status.crowd === "number" ? status.crowd : room.util7d) / 100);

  let capacityScore = 0.8;
  if (prefs.capacity) capacityScore = room.capacity >= prefs.capacity ? 1 : 0.15;

  const weights = room.walkFromYou
    ? { duration: 0.32, requirements: 0.22, distance: 0.24, vibe: 0.09, util: 0.08, capacity: 0.05 }
    : { duration: 0.35, requirements: 0.25, distance: 0.15, vibe: 0.10, util: 0.10, capacity: 0.05 };
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
        <div key={i} style={{ width: 8, height, borderRadius: 2, background: i < filled ? color : "rgba(196,181,253,0.08)", transition: "background 300ms ease" }} />
      ))}
    </div>
  );
}

// Room check-in (server/checkin.js): a booking must be checked into within
// this many minutes (door QR or the "Check in" button), else it is released.
const CHECKIN_GRACE_MIN = 10;
const ROOM_NAME = Object.fromEntries(STUDY_ROOMS.map((r) => [r.id, r.name]));

function Pill({ children, tone = "default" }) {
  const tones = {
    default: { bg: "rgba(196,181,253,0.06)", color: "#D2C8F5", border: "rgba(196,181,253,0.12)" },
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

function DemoRoomCsiBadge({ mesh, onOpenDevDashboard }) {
  // Status of the 4-board ESP32-S3 mesh (the old 2-board CSI pair is retired).
  if (!mesh) return <div style={{ marginTop: 2, fontSize: 11.5, color: "#857DA8" }}>⚪ Wi-Fi mesh status unavailable</div>;
  const nodes = Object.values(mesh.nodes || {});
  const online = nodes.filter((n) => n.online).length;
  const sim = mesh.mode === "simulation";
  const live = !sim && online >= 2;
  return (
    <div style={{ marginTop: 2, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", background: "rgba(196,181,253,0.03)", border: "1px solid rgba(196,181,253,0.07)", borderRadius: 10, padding: "8px 10px" }}>
      <span style={{ fontSize: 12, fontWeight: 700 }}>
        {sim ? "🟡 Wi-Fi mesh · simulation" : live ? "🟢 Wi-Fi mesh live" : "🔴 Wi-Fi boards offline"}
        <span style={{ fontWeight: 500, color: "#A39CC4" }}> · {online}/{nodes.length || 4} boards · {mesh.pairsHeard ?? 0}/6 pairs</span>
      </span>
      {onOpenDevDashboard && (
        <button onClick={onOpenDevDashboard} style={{ background: "none", border: "1px solid rgba(196,181,253,0.12)", borderRadius: 8, padding: "3px 8px", fontSize: 10.5, color: "#A39CC4", cursor: "pointer" }}>🛠 Developer view</button>
      )}
    </div>
  );
}

function RoomCard({ room, status, prefs, booking, onBook, hasActiveBooking, highlight, scoreBadge, csi, mesh, door, onOpenDevDashboard, hereCount = 0, showQr = true }) {
  const vm = vibeMeta[room.vibe];
  const VibeIcon = vm.icon;
  const meta = statusMeta(room, status, prefs, booking);
  const isMine = booking && booking.roomId === room.id;
  const canBook = room.bookable !== false && status.free && !hasActiveBooking;
  const [qrOpen, setQrOpen] = useState(false);
  const canCheckIn = !!ROOM_NAME[room.id] && showQr;
  return (
    <div style={{ background: "#120F1E", border: highlight ? "1px solid rgba(167,139,250,0.4)" : "1px solid rgba(196,181,253,0.07)", borderRadius: 18, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 17, fontWeight: 700, color: "#F4F1FF" }}>{room.name}</div>
          <div style={{ fontSize: 12.5, color: "#A39CC4", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
            <MapPin size={12} /> {room.floor} · {room.walk}
          </div>
          {room.description && <div style={{ fontSize: 11.5, color: "#6A6390", marginTop: 4, lineHeight: 1.45 }}>{room.description}</div>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          {typeof scoreBadge === "number" && <Pill tone="lime">{scoreBadge}% match</Pill>}
          <Pill tone={meta.tone}><Clock size={10} style={{ marginRight: 4, verticalAlign: -1 }} />{meta.label}</Pill>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <GhostMeter pct={room.sensing === "wifi" ? (status.crowd || 0) : room.util7d} />
        <span style={{ fontSize: 11, color: "#857DA8", fontFamily: "'JetBrains Mono', monospace" }}>
          {room.sensing === "wifi" ? (status.closed ? `opens ${status.busyUntil}` : `Wi-Fi crowd · ${status.crowd}% full`) : `${room.util7d}% booked this week`}
        </span>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {hereCount > 0 && <Pill tone="lime"><Users size={10} style={{ marginRight: 4, verticalAlign: -1 }} />{hereCount} checked in</Pill>}
        <Pill><Users size={10} style={{ marginRight: 4, verticalAlign: -1 }} />{room.capacity} seats</Pill>
        <Pill><VibeIcon size={10} style={{ marginRight: 4, verticalAlign: -1 }} />{vm.label}</Pill>
        {room.tags.includes("plug") && <Pill><Plug size={10} style={{ marginRight: 4, verticalAlign: -1 }} />plugs</Pill>}
        {room.tags.includes("wifi+") && <Pill><Wifi size={10} style={{ marginRight: 4, verticalAlign: -1 }} />wifi+</Pill>}
        {canCheckIn && (
          <button onClick={() => setQrOpen(true)} title="Show this room's door QR on screen" style={{ marginLeft: "auto", background: "rgba(196,181,253,0.06)", border: "1px solid rgba(196,181,253,0.16)", color: "#D2C8F5", borderRadius: 999, padding: "3px 10px", fontSize: 11, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", whiteSpace: "nowrap" }}>
            <QrCode size={11} /> check-in QR
          </button>
        )}
      </div>
      {qrOpen && <Suspense fallback={null}><CheckInQr roomId={room.id} roomName={room.name} onClose={() => setQrOpen(false)} /></Suspense>}

      {room.csiEnabled && <MeshRadar mesh={mesh} />}
      {room.csiEnabled && <DoorCounter door={door} mesh={mesh} checkedIn={hereCount} />}
      {room.csiEnabled && (
        <a href="/lab" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, textDecoration: "none", background: "linear-gradient(180deg, rgba(167,139,250,0.12), rgba(167,139,250,0.04))", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 14, padding: "10px 12px", color: "#F4F1FF" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 14 }}>Open the Sensing Lab <span style={{ fontSize: 10.5, fontWeight: 700, color: "#0A0812", background: "#F5B544", borderRadius: 999, padding: "1px 7px", marginLeft: 4, verticalAlign: 1 }}>SIMULATION</span></span>
            <span style={{ fontSize: 12, color: "#A39CC4", lineHeight: 1.4 }}>This room's 4-board setup as a virtual lab: move 0–10 people and watch all 12 links react.</span>
          </span>
          <ChevronRight size={18} color="#C4B5FD" style={{ flexShrink: 0 }} />
        </a>
      )}
      {room.csiEnabled && <DemoRoomCsiBadge mesh={mesh} onOpenDevDashboard={onOpenDevDashboard} />}

      {!room.bookable ? (
        <div style={{ marginTop: 4, background: "rgba(196,181,253,0.03)", border: "1px solid rgba(196,181,253,0.07)", borderRadius: 12, padding: "9px 12px", fontSize: 12.5, color: "#A39CC4", textAlign: "center" }}>
          {status.closed ? `Closed now · opens ${status.busyUntil}` : "Walk in · no booking needed"}
        </div>
      ) : isMine ? (
        <div style={{ marginTop: 4, background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 12, padding: "9px 12px", fontSize: 12.5, color: "#D2C8F5", textAlign: "center", fontWeight: 700 }}>
          🔒 Reserved by you
        </div>
      ) : (
        <button onClick={() => canBook && onBook(room, status)} disabled={!canBook} style={{
          marginTop: 4, background: canBook ? "#C4B5FD" : "rgba(196,181,253,0.06)", color: canBook ? "#07060C" : "#857DA8",
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
  const ctl = { background: "transparent", color: "#F4F1FF", border: "none", fontSize: 12.5, fontFamily: "'JetBrains Mono', monospace" };
  const chip = (active) => ({ background: active ? "rgba(61,220,151,0.14)" : "rgba(196,181,253,0.05)", color: active ? "#3DDC97" : "#D2C8F5",
    border: `1px solid ${active ? "rgba(61,220,151,0.35)" : "rgba(196,181,253,0.12)"}`, borderRadius: 999, padding: "2px 8px", fontSize: 10.5, cursor: "pointer", whiteSpace: "nowrap" });
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: "#120F1E", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 14, padding: "8px 10px" }}>
      <CalendarClock size={14} color="#A39CC4" />
      <select aria-label="Day" value={day} onChange={(e) => setDay(e.target.value)} style={ctl}>
        {PICKER_DAYS.map((d) => <option key={d} value={d} style={{ background: "#120F1E" }}>{d}</option>)}
      </select>
      <span style={{ color: "#2D2648" }}>|</span>
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
    <div style={{ background: "#141123", border: "1px dashed rgba(167,139,250,0.35)", borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#F4F1FF" }}>{label}</div>
        <button onClick={onTemplate} style={{ background: "none", border: "none", color: "#A39CC4", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
          <Download size={11} /> template
        </button>
      </div>
      <label style={{ background: "#C4B5FD", color: "#07060C", border: "none", borderRadius: 10, padding: "9px 10px", fontWeight: 700, fontSize: 12.5, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <Upload size={14} /> upload CSV
        <input type="file" accept=".csv" onChange={onFile} style={{ display: "none" }} />
      </label>
      <div style={{ fontSize: 10.5, color: "#857DA8", display: "flex", alignItems: "flex-start", gap: 4 }}>
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
    <div style={{ background: "#1A1630", borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      {roomOptions && (
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={{ background: "#120F1E", color: "#F4F1FF", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 10, padding: "8px 10px", fontSize: 12.5 }}>
          {roomOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={{ flex: 1, background: "#120F1E", color: "#F4F1FF", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 10, padding: "8px 10px", fontSize: 12.5 }} />
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={{ flex: 1, background: "#120F1E", color: "#F4F1FF", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 10, padding: "8px 10px", fontSize: 12.5 }} />
      </div>
      <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="subject / class code" style={{ background: "#120F1E", color: "#F4F1FF", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 10, padding: "8px 10px", fontSize: 12.5, outline: "none" }} />
      {error && <div style={{ fontSize: 11.5, color: "#FF8B8B" }}>{error}</div>}
      <button onClick={submit} style={{ background: "#E9E3FF", color: "#07060C", border: "none", borderRadius: 10, padding: "8px 10px", fontWeight: 700, fontSize: 12.5, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
        <Plus size={13} /> add to {day}'s timetable
      </button>
    </div>
  );
}

function GhostSlotInfo() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: "#120F1E", border: "1px solid rgba(196,181,253,0.07)", borderRadius: 14, padding: 12 }}>
      <button onClick={() => setOpen((o) => !o)} style={{ background: "none", border: "none", color: "#A39CC4", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
        <Info size={13} color="#C4B5FD" /> What's a Ghost Slot? <span style={{ marginLeft: "auto" }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={{ fontSize: 12, color: "#CFC7EC", lineHeight: 1.5, marginTop: 8 }}>
          A <b style={{ color: "#E9E3FF" }}>Ghost Slot</b> is a campus space that's technically assigned or timetabled — but sitting empty right now. GhostSlot discovers these hidden pockets of capacity and matches them to students who actually need space.
        </div>
      )}
    </div>
  );
}

// =========================================================================
// DEMO ROOM — CSI DEVELOPER DASHBOARD (debug view, separate from student UI)
// =========================================================================
function CsiDevDashboard({ csi, mesh, onClose }) {
  const row = (label, value) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid rgba(196,181,253,0.06)", fontSize: 12.5 }}>
      <span style={{ color: "#A39CC4" }}>{label}</span>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#F4F1FF" }}>{value}</span>
    </div>
  );
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 30 }} />
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "min(100vw, 460px)", background: "#100D1B", borderRadius: "20px 20px 0 0", zIndex: 35, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 -8px 40px rgba(0,0,0,0.6)" }}>
        <div style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16 }}>🛠 Demo Room — Wi-Fi mesh (developer view)</div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#A39CC4", cursor: "pointer" }}><X size={18} /></button>
          </div>
          <div style={{ marginBottom: 4, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: "#A39CC4", fontWeight: 700 }}>People-count mesh (4 × ESP32-S3)</div>
          <MeshDevRows mesh={mesh} row={row} />
          <div style={{ marginTop: 10, fontSize: 11, color: "#857DA8", lineHeight: 1.5 }}>
            The count comes from a model calibrated in this room on labelled recordings; its held-out accuracy is shown on the radar.
          </div>
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
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "min(100vw, 460px)", background: "#100D1B", borderRadius: "20px 20px 0 0", zIndex: 35, maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 -8px 40px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 2px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(196,181,253,0.15)" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 18px 14px" }}>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 17 }}>
            Sort &amp; Filter {activeCount > 0 && <span style={{ background: "#C4B5FD", color: "#0A0812", borderRadius: 999, padding: "2px 9px", fontSize: 12, marginLeft: 6 }}>{activeCount}</span>}
          </div>
          <button onClick={clearAll} style={{ background: "none", border: "none", color: "#FF8B8B", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Clear all</button>
        </div>

        <div style={{ overflowY: "auto", padding: "0 18px 110px", display: "flex", flexDirection: "column", gap: 24 }}>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#857DA8", marginBottom: 10, letterSpacing: 1.5 }}>SORT BY</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {SORT_OPTIONS.map(opt => (
                <button key={opt.id} onClick={() => setSort(opt.id)} style={{ background: prefs.sortBy === opt.id ? "#C4B5FD" : "#1A1630", color: prefs.sortBy === opt.id ? "#0A0812" : "#CFC7EC", border: "none", borderRadius: 14, padding: "12px 6px", cursor: "pointer", fontSize: 12, fontWeight: 700, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, transition: "background 150ms" }}>
                  <span style={{ fontSize: 20 }}>{opt.emoji}</span>{opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#857DA8", marginBottom: 10, letterSpacing: 1.5 }}>ROOM TYPE</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ROOM_TYPE_OPTIONS.map(opt => (
                <button key={opt.id} onClick={() => toggle("roomType", opt.id)} style={{ background: prefs.roomType === opt.id ? "#E9E3FF" : "#1A1630", color: prefs.roomType === opt.id ? "#07060C" : "#CFC7EC", border: "none", borderRadius: 999, padding: "9px 15px", cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                  {opt.emoji} {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#857DA8", marginBottom: 10, letterSpacing: 1.5 }}>WALK TIME</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {WALK_OPTIONS.map(opt => (
                <button key={String(opt.id)} onClick={() => setWalk(opt.id)} style={{ background: prefs.walkTime === opt.id ? "#E9E3FF" : "#1A1630", color: prefs.walkTime === opt.id ? "#07060C" : "#CFC7EC", border: "none", borderRadius: 999, padding: "9px 15px", cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#857DA8", marginBottom: 10, letterSpacing: 1.5 }}>CAPACITY</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {CAP_OPTIONS.map(opt => (
                <button key={opt.id} onClick={() => setCap(opt.id)} style={{ background: prefs.capacity === opt.id ? "#E9E3FF" : "#1A1630", color: prefs.capacity === opt.id ? "#07060C" : "#CFC7EC", border: "none", borderRadius: 999, padding: "9px 15px", cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#857DA8", marginBottom: 10, letterSpacing: 1.5 }}>VIBE</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[{v: null, l: "Any"}, {v: "silent", l: "🤫 Silent"}, {v: "quiet", l: "🔇 Quiet-ish"}, {v: "medium", l: "🔉 Background hum"}, {v: "loud", l: "🔊 Chaos energy"}].map(({v, l}) => (
                <button key={String(v)} onClick={() => setPrefs(p => ({ ...p, vibe: p.vibe === v ? null : v }))} style={{ background: prefs.vibe === v ? "#E9E3FF" : "#1A1630", color: prefs.vibe === v ? "#07060C" : "#CFC7EC", border: "none", borderRadius: 999, padding: "9px 15px", cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#857DA8", marginBottom: 10, letterSpacing: 1.5 }}>MUST HAVE</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[["plug", "⚡ Charging"], ["wifi+", "📶 Wi-Fi+"], ["ac", "❄️ AC"]].map(([tag, label]) => (
                <button key={tag} onClick={() => toggleReq(tag)} style={{ background: prefs.requirements.includes(tag) ? "#C4B5FD" : "#1A1630", color: prefs.requirements.includes(tag) ? "#0A0812" : "#CFC7EC", border: "none", borderRadius: 999, padding: "9px 15px", cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#1A1630", borderRadius: 14, padding: "12px 14px" }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Free rooms only</div>
              <div style={{ fontSize: 11.5, color: "#A39CC4", marginTop: 2 }}>Hide occupied rooms from results</div>
            </div>
            <div onClick={() => setPrefs(p => ({ ...p, freeOnly: !p.freeOnly }))} style={{ width: 46, height: 26, borderRadius: 13, background: prefs.freeOnly ? "#C4B5FD" : "#221C3B", cursor: "pointer", position: "relative", transition: "background 200ms", flexShrink: 0 }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", background: prefs.freeOnly ? "#0A0812" : "#F4F1FF", position: "absolute", top: 4, left: prefs.freeOnly ? 24 : 4, transition: "left 200ms" }} />
            </div>
          </div>

        </div>

        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "12px 18px 28px", background: "linear-gradient(transparent, #100D1B 35%)" }}>
          <button onClick={onClose} style={{ width: "100%", background: "linear-gradient(180deg, #F1ECFF, #A78BFA)", color: "#0A0812", boxShadow: "0 1px 0 rgba(255,255,255,.5) inset, 0 6px 18px rgba(0,0,0,.35)", border: "none", borderRadius: 14, padding: "14px", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif" }}>
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
  // An active booking stores its real end time, so the countdown stays right
  // across reloads, sleeping phones and background tabs.
  const [bookingRaw, setBooking] = useState(null); // { roomId, slotId, roomName, endsAt }
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!bookingRaw) return;
    setNowTick(Date.now());
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [bookingRaw]);
  const booking = useMemo(() => (bookingRaw ? { ...bookingRaw, secondsLeft: Math.max(0, Math.round((bookingRaw.endsAt - nowTick) / 1000)) } : null), [bookingRaw, nowTick]);
  const bookingRef = useRef(null);
  useEffect(() => { bookingRef.current = bookingRaw; }, [bookingRaw]);
  // Ignore a second tap on the same action within a short window.
  const lastTap = useRef({});
  const once = (k, ms = 800) => { const n = Date.now(); if (n - (lastTap.current[k] || 0) < ms) return false; lastTap.current[k] = n; return true; };
  const queryLock = useRef(false);
  // Where you are on campus (GPS, picked, map tap or a door QR).
  const [you, setYouRaw] = useState(null);
  const [mapFocusId, setMapFocusId] = useState(null);
  const [anchorsVersion, setAnchorsVersion] = useState(0);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  const restoredFor = useRef(null);
  const [karma, setKarma] = useState(0);
  // Real per-account counters (demo accounts start with sample numbers).
  const [stats, setStats] = useState(FRESH_STATS);
  const [extraBooked, setExtraBooked] = useState(0);
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
  const role = ROLE_TABS[currentUser?.role] ? currentUser.role : "student";
  const isStudent = role === "student";
  const showKarma = isStudent && !currentUser?.isMinor;
  // When someone signs in (or a session is restored), open their role's home
  // and load the matching demo timetable (classes taken vs classes taught).
  useEffect(() => {
    if (!currentUser) return;
    setTab(ROLE_TABS[role][0].id);
    setTtSubTab("mine");
    setShowNotifs(false);
    // Restore this person's saved timetable, booking and karma (this browser).
    const saved = loadState(currentUser.id);
    const savedSlots = saved && cleanSlots(saved.mySlots);
    const savedRooms = saved && cleanRoomSlots(saved.roomSlots);
    // Only the shared demo accounts get the sample timetable/karma; a new sign-up starts empty.
    const demo = !!currentUser.isDemo;
    setMySlots(savedSlots || (demo ? (role === "faculty" ? SEED_TEACHING_SLOTS : SEED_MY_SLOTS) : []));
    let b = saved && saved.booking;
    const bookingOk = b && typeof b.endsAt === "number" && b.endsAt > Date.now() && typeof b.roomId === "string";
    const rooms = savedRooms || SEED_ROOM_SLOTS;
    // Drop leftover "Reserved (you)" slots except the live booking.
    const tidy = Object.fromEntries(Object.entries(rooms).map(([k, v]) => [k, v.filter((x) => !String(x.id).startsWith("book_") || (bookingOk && x.id === b.slotId))]));
    setRoomSlots(tidy);
    setBooking(bookingOk ? b : null);
    bookingRef.current = bookingOk ? b : null;
    setKarma(saved && Number.isFinite(saved.karma) ? saved.karma : (demo ? 74 : 0));
    setStats(cleanStats(saved && saved.stats) || (demo ? DEMO_STATS : FRESH_STATS));
    setExtraBooked(0);
    // Where you are: a fresh door scan wins over the saved spot.
    let loc = loadLocation(currentUser.id);
    try {
      const at = sessionStorage.getItem("gs.pendingAt");
      if (at) {
        sessionStorage.removeItem("gs.pendingAt");
        const place = findPlace(placeList(ROOM_META), at);
        if (place) { loc = { x: place.x, y: place.y, label: place.label, placeId: place.id, source: "qr", at: Date.now() }; setToast(`You're at ${place.label}. Showing the closest free spots from here.`); }
        if (ROOM_NAME[at] && role !== "facilities") setPendingQrRoom(at); // a room's door QR also checks you in
      }
    } catch { /* ignore */ }
    setYouRaw(loc);
    restoredFor.current = currentUser.id;
  }, [currentUser?.id, role]);

  const setYou = (loc) => { setYouRaw(loc); if (currentUser) saveLocation(currentUser.id, loc); if (loc) setToast(`Got it. Walking times now start from ${loc.label.replace(/^near /, "")}.`); };

  // Restore an existing session (httpOnly cookie) and check if AI is on.
  useEffect(() => {
    api("/auth/session").then(({ user }) => setCurrentUser(user || null)).catch(() => setCurrentUser(null)).finally(() => setAuthChecked(true));
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
  const [mySlots, setMySlots] = useState([]);
  const [roomSlots, setRoomSlots] = useState(SEED_ROOM_SLOTS);
  // Save on every change (only after this user's state has been restored).
  useEffect(() => {
    if (!currentUser || restoredFor.current !== currentUser.id) return;
    saveState(currentUser.id, { mySlots, roomSlots, booking: bookingRaw, karma, stats });
  }, [currentUser?.id, mySlots, roomSlots, bookingRaw, karma, stats]);
  const [ttSubTab, setTtSubTab] = useState("mine");
  const [myCsvSummary, setMyCsvSummary] = useState(null);
  const [roomCsvSummary, setRoomCsvSummary] = useState(null);

  // Demo Room CSI status — polled from the backend (server/csi.js). Never
  // generated client-side; if the backend is unreachable this simply stays
  // null and the UI shows "CSI status unavailable" rather than inventing a state.
  const csiStatus = null; // the retired 2-board CSI pair; the 4-board mesh below replaces it
  const [showCsiDevDashboard, setShowCsiDevDashboard] = useState(false);
  // People count from the 4-board CSI mesh (server/csimesh.js). Same rule: never invented here.
  const meshStatus = useMeshStatus();
  const doorStatus = useDoorStatus();

  // Release the room when the booking's time is up (checked every tick, so a
  // phone that slept through the end time releases it as soon as it wakes).
  useEffect(() => {
    if (!bookingRaw || nowTick < bookingRaw.endsAt) return;
    const b = bookingRaw;
    setRoomSlots((rs) => ({ ...rs, [b.roomId]: (rs[b.roomId] || []).filter((s) => s.id !== b.slotId) }));
    setBooking(null);
    bookingRef.current = null;
    setToast("Time's up. Room released automatically. Vacate before the next class catches you red-handed.");
  }, [bookingRaw, nowTick]);

  // ---- Room check-in (server/checkin.js). Counts come from the server; names never do.
  const [checkins, setCheckins] = useState({ mine: null, counts: {} });
  const [pendingQrRoom, setPendingQrRoom] = useState(null);
  const loadCheckins = () => api("/checkins").then((r) => setCheckins({ mine: r.mine || null, counts: r.counts || {} })).catch(() => {});
  useEffect(() => {
    if (!currentUser) { setCheckins({ mine: null, counts: {} }); return; }
    loadCheckins();
    const t = setInterval(loadCheckins, 15000);
    return () => clearInterval(t);
  }, [currentUser?.id]);
  async function checkIn(roomId, method) {
    if (role === "facilities" || !once(`checkin:${roomId}`, 1500)) return;
    const b = bookingRef.current;
    const forBooking = !!b && b.roomId === roomId;
    const minutes = forBooking ? Math.min(180, Math.max(15, Math.ceil((b.endsAt - Date.now()) / 60000))) : 60;
    try {
      const r = await api("/checkins", { method: "POST", body: { roomId, minutes, method } });
      setCheckins({ mine: r.mine || null, counts: r.counts || {} });
      const name = ROOM_NAME[roomId] || roomId;
      const via = method === "qr" ? " via the door QR" : "";
      if (forBooking && !b.checkedIn) {
        const nb = { ...b, checkedIn: true };
        bookingRef.current = nb;
        setBooking(nb);
        if (showKarma) { setKarma((k) => k + 2); setStats((st) => ({ ...st, onTime: st.onTime + 1 })); }
        setToast(`Checked in at ${name}${via}. You actually showed up${showKarma ? " · +2 karma" : ""}.`);
      } else {
        const n = (r.counts || {})[roomId] || 1;
        setToast(`Checked in at ${name}${via}. ${n === 1 ? "You're the only one here." : `${n} people here now.`}`);
      }
    } catch (e) {
      setToast(e.status === 400 ? "That room can't be checked into." : e.message || "Couldn't check in. Try again.");
    }
  }
  async function checkOut(silent = false) {
    try {
      const r = await api("/checkins/me", { method: "DELETE" });
      setCheckins({ mine: null, counts: r.counts || {} });
      if (!silent) setToast("Checked out. The room count is updated for everyone.");
    } catch { if (!silent) setToast("Couldn't check out. Try again."); }
  }
  // In-app scanner. scan = null | { forBooking: bool }
  const [scan, setScan] = useState(null);
  function onScannedRoom(id) {
    const b = bookingRef.current;
    const wantBooking = scan && scan.forBooking;
    setScan(null);
    if (wantBooking && b && b.roomId !== id) {
      setToast(`That's the QR for ${ROOM_NAME[id] || id}. Your booking is ${b.roomName}: scan the QR on that door.`);
      return;
    }
    checkIn(id, "qr");
  }
  // A scanned door QR (remembered through login) checks you in.
  useEffect(() => {
    if (!currentUser || !pendingQrRoom) return;
    const id = pendingQrRoom;
    setPendingQrRoom(null);
    checkIn(id, "qr");
  }, [currentUser?.id, pendingQrRoom]);
  // Booked but never checked in: release it after the grace period.
  useEffect(() => {
    const b = bookingRaw;
    if (!b || b.checkedIn || !b.checkInBy || nowTick < b.checkInBy) return;
    setRoomSlots((rs) => ({ ...rs, [b.roomId]: (rs[b.roomId] || []).filter((s) => s.id !== b.slotId) }));
    setBooking(null);
    bookingRef.current = null;
    if (showKarma) { setKarma((k) => Math.max(0, k - 5)); setStats((st) => ({ ...st, ghosted: st.ghosted + 1 })); }
    setToast(`No check-in within ${CHECKIN_GRACE_MIN} min, so ${b.roomName} went back to everyone. No ghost bookings 👻`);
  }, [bookingRaw, nowTick]);

  // Online / offline banner.
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // A door QR opens GhostSlot as /?at=<place id>. Remember it (it may have to
  // wait for login), then tidy the address bar.
  useEffect(() => {
    try {
      const at = new URLSearchParams(window.location.search).get("at");
      if (at && /^[A-Za-z0-9:_-]{1,60}$/.test(at)) sessionStorage.setItem("gs.pendingAt", at);
      if (at) window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  const nowMin = toMin(time);
  const myFreeWindows = useMemo(() => freeWindows(mySlots, day), [mySlots, day]);
  const myAvailableNow = useMemo(() => getAvailableDuration(myFreeWindows, nowMin), [myFreeWindows, nowMin]);

  const roomsWithStatus = useMemo(() => {
    return ROOM_META.map((r) => {
      const mins = you && r.pos ? walkMinutes(you, r.pos) : null;
      const room = mins != null ? { ...r, walk: walkLabel(mins), walkFromYou: true } : r;
      return { room, status: spaceStatus(r, roomSlots[r.id] || [], day, nowMin) };
    });
  }, [roomSlots, day, nowMin, you]);
  const places = useMemo(() => placeList(ROOM_META), []);

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
    if (!raw || !raw.trim() || queryLock.current) return;
    raw = raw.slice(0, 300);
    queryLock.current = true;
    try { await runQueryInner(raw); } finally { queryLock.current = false; }
  }
  async function runQueryInner(raw) {

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

  function handleBook(room, status, wanted, subject) {
    if (role === "facilities") return; // facilities staff don't book rooms
    if (!once("book", 1200)) return;   // double tap / double click
    if (bookingRef.current) { setToast("You already have a room. End it from the bar at the top first."); return; }
    if (room.bookable === false) { setToast(`${room.name} is walk-in only. No booking needed.`); return; }
    // Re-check right now: the card on screen might be a few seconds old.
    const fresh = spaceStatus(room, roomSlots[room.id] || [], day, nowMin);
    if (!fresh.free) { setToast(`${room.name} just got taken. Pick the next best one.`); return; }
    status = fresh;
    const duration = Math.max(15, Math.min(wanted || prefs.duration || 30, status.freeFor));
    const endMin = nowMin + duration;
    const slotId = `book_${Date.now()}`;
    const label = role === "faculty" ? `${subject || "Extra class"} (you)` : "Reserved (you)";
    setRoomSlots((rs) => ({ ...rs, [room.id]: [...(rs[room.id] || []), { id: slotId, day, start: time, end: toHHMM(endMin), subject: label }] }));
    const nb = { roomId: room.id, slotId, roomName: room.name, endsAt: Date.now() + duration * 60 * 1000, checkInBy: Date.now() + CHECKIN_GRACE_MIN * 60 * 1000, checkedIn: false };
    bookingRef.current = nb;
    setBooking(nb);
    if (role === "faculty") setExtraBooked((n) => n + 1);
    setToast(role === "faculty" ? `${room.name} booked for ${subject || "your extra class"}, ${time}–${toHHMM(endMin)}. Check in within ${CHECKIN_GRACE_MIN} min.` : `${room.name} is yours for ${fmtMin(duration)}. Check in within ${CHECKIN_GRACE_MIN} min or it goes back to everyone.`);
  }
  function endEarly() {
    if (!booking || !once("end", 1000)) return;
    if (checkins.mine && checkins.mine.roomId === booking.roomId) checkOut(true);
    bookingRef.current = null;
    setRoomSlots((rs) => ({ ...rs, [booking.roomId]: (rs[booking.roomId] || []).filter((s) => s.id !== booking.slotId) }));
    setBooking(null);
    if (showKarma) { setKarma((k) => k + 5); setStats((st) => ({ ...st, early: st.early + 1 })); setToast("Ended early. +5 room karma — the campus thanks you."); }
    else setToast("Room released early. It's back on the map for everyone.");
  }
  function ping(person) { if (pinged[person] || !once(`ping:${person}`)) return; setPinged((p) => ({ ...p, [person]: true })); setToast(`${person} has been pinged. No cap, they'll probably see it eventually.`); }

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
    const r = u.role || "student";
    setToast(how === "signup"
      ? `Account made, ${u.name}. Welcome to GhostSlot.`
      : r === "student" ? `Welcome back, ${u.name}. Try not to ghost your bookings this time.`
      : r === "faculty" ? `Welcome back, ${u.name}. Here's your teaching day.`
      : `Welcome back, ${u.name}. Here's what needs fixing.`);
  }
  async function handleLogout(everywhere = false) {
    try { await api(everywhere ? "/auth/logout-all" : "/auth/logout", { method: "POST" }); } catch { /* session already gone */ }
    setCurrentUser(null); setBooking(null);
  }
  async function deleteAccount() {
    setDeleteErr("");
    try {
      await api("/auth/delete-account", { method: "POST", body: { password: deletePw } });
      clearState(currentUser?.id);
      setDeletePw(""); setDeleteOpen(false); setCurrentUser(null); setBooking(null);
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
    if (!isStudent) { setTab("map"); return; }
    setTab("find");
    setShowFilters(false);
    setPrefs((p) => ({ ...DEFAULT_PREFS, location: match.block, sortBy: p.sortBy }));
  }

  if (!authChecked) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#07060C" }}>
        <BrandMark size={48} glow />
      </div>
    );
  }
  if (!currentUser) {
    return <AuthScreen onAuthed={handleAuthed} />;
  }

  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const navItems = ROLE_TABS[role];
  // A tab from another role (e.g. left over from a previous login) falls back to home.
  const view = navItems.some((n) => n.id === tab) ? tab : navItems[0].id;
  const roleMeta = ROLE_META[role];

  return (
    <div className="gs-root" style={{ fontFamily: "'Inter', sans-serif", background: "#07060C", minHeight: "100vh", color: "#F4F1FF" }}>
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { display: none; }
        input::placeholder { color: #857DA8; }
        @keyframes gs-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .gs-spin { animation: gs-spin 0.9s linear infinite; }
        @keyframes gs-scan { 0% { top: 8%; } 50% { top: 90%; } 100% { top: 8%; } }
        .gs-scanline { animation: gs-scan 2.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .gs-scanline { animation: none; top: 50%; } }
        @media print {
          body * { visibility: hidden !important; }
          .gs-qr-grid, .gs-qr-grid * { visibility: visible !important; }
          .gs-qr-grid { position: absolute; left: 0; top: 0; width: 100%; grid-template-columns: repeat(3, 1fr) !important; }
          .gs-qr-card { break-inside: avoid; border: 1px solid #ccc; }
        }
        /* ── mobile defaults ── */
        .gs-root { max-width: 460px; margin: 0 auto; padding-bottom: 84px; }
        .gs-sidebar { display: none; }
        .gs-desktop-topbar { display: none; }
        /* ── desktop overrides ── */
        @media (min-width: 768px) {
          .gs-root { max-width: none; margin: 0; padding-bottom: 0; display: flex; height: 100vh; overflow: hidden; }
          .gs-sidebar { display: flex; flex-direction: column; width: 240px; min-width: 240px; background: #0A0812; border-right: 1px solid rgba(196,181,253,0.07); height: 100vh; position: sticky; top: 0; overflow-y: auto; }
          .gs-main { flex: 1; min-width: 0; height: 100vh; overflow-y: auto; display: flex; flex-direction: column; }
          .gs-mobile-topbar { display: none !important; }
          .gs-desktop-topbar { display: flex !important; align-items: center; justify-content: space-between; padding: 18px 32px; border-bottom: 1px solid rgba(196,181,253,0.06); position: sticky; top: 0; background: #07060C; z-index: 5; flex-shrink: 0; }
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
        <div style={{ padding: "22px 20px 18px", borderBottom: "1px solid rgba(196,181,253,0.07)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <BrandMark size={34} />
            <Wordmark size={20} />
          </div>
          <div style={{ fontSize: 10.5, color: "#4E4670" }}>campus space intelligence</div>
        </div>
        <nav style={{ padding: "14px 12px", flex: 1 }}>
          {navItems.map(n => { const Icon = n.icon; const active = view === n.id; return (
            <button key={n.id} onClick={() => setTab(n.id)} style={{ width: "100%", background: active ? "rgba(167,139,250,0.15)" : "none", border: active ? "1px solid rgba(167,139,250,0.25)" : "1px solid transparent", borderRadius: 10, padding: "10px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, color: active ? "#E9E3FF" : "#857DA8", marginBottom: 4, textAlign: "left", transition: "all 150ms" }}>
              <Icon size={17} /><span style={{ fontWeight: 600, fontSize: 13.5 }}>{n.label}</span>
            </button>
          );})}
        </nav>
        <div style={{ padding: "14px 20px", borderTop: "1px solid rgba(196,181,253,0.07)" }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#F4F1FF" }}>{currentUser.name}</div>
          <div style={{ fontSize: 11, color: "#857DA8", fontFamily: "'JetBrains Mono', monospace", marginBottom: 10 }}>{currentUser.roll} · {ROLE_META[currentUser.role]?.label || "Student"}</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {showKarma && <Pill tone="lime"><Flame size={10} style={{ marginRight: 4, verticalAlign: -1 }} />{karma}</Pill>}
            <button onClick={() => handleLogout()} style={{ background: "none", border: "none", color: "#FF8B8B", fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}><LogOut size={11} /> logout</button>
          </div>
        </div>
      </aside>
      {/* desktop: gs-main wraps everything else */}
      <div className="gs-main">
      {/* desktop topbar */}
      <div className="gs-desktop-topbar">
        <div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 20 }}>{navItems.find(n => n.id === view)?.label}</div>
          <div style={{ fontSize: 11.5, color: "#A39CC4", marginTop: 2 }}>{roleMeta.tagline}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <TimeDayPicker {...pickerProps} />
          {showKarma && <Pill tone="lime"><Flame size={10} style={{ marginRight: 4, verticalAlign: -1 }} />{karma}</Pill>}
          {role !== "facilities" && <button onClick={() => setScan({ forBooking: false })} aria-label="Scan a door QR to check in" title="Scan a door QR to check in" style={{ background: "#120F1E", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 10, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><ScanLine size={16} color="#F4F1FF" /></button>}
          <button onClick={() => setShowNotifs(s => !s)} style={{ background: "#120F1E", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 10, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", position: "relative" }}>
            <Bell size={16} color="#F4F1FF" />{currentUser.isDemo && <span style={{ position: "absolute", top: -3, right: -3, width: 8, height: 8, borderRadius: 999, background: "#FF6B6B" }} />}
          </button>
        </div>
      </div>
      {/* mobile topbar */}
      <div className="gs-mobile-topbar" style={{ padding: "20px 18px 12px", position: "sticky", top: 0, background: "#07060C", zIndex: 5 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BrandMark size={34} />
            <Wordmark size={20} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {showKarma && <Pill tone="lime"><Flame size={10} style={{ marginRight: 4, verticalAlign: -1 }} />{karma}</Pill>}
            {role !== "facilities" && <button onClick={() => setScan({ forBooking: false })} aria-label="Scan a door QR to check in" title="Scan a door QR to check in" style={{ background: "#120F1E", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 10, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><ScanLine size={16} color="#F4F1FF" /></button>}
            <button onClick={() => setShowNotifs((s) => !s)} style={{ background: "#120F1E", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 10, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", position: "relative" }}>
              <Bell size={16} color="#F4F1FF" />
              {currentUser.isDemo && <span style={{ position: "absolute", top: -3, right: -3, width: 8, height: 8, borderRadius: 999, background: "#FF6B6B" }} />}
            </button>
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: "#A39CC4", marginTop: 6, marginBottom: 8 }}>{roleMeta.tagline}</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {roleMeta.steps.map(([t, sub], i) => (
            <div key={t} style={{ flex: 1, background: "#120F1E", borderRadius: 10, padding: "6px 8px", border: "1px solid rgba(196,181,253,0.06)" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#E9E3FF" }}>{i + 1}. {t}</div>
              <div style={{ fontSize: 9.5, color: "#857DA8" }}>{sub}</div>
            </div>
          ))}
        </div>
        <TimeDayPicker {...pickerProps} />
      </div>{/* end gs-mobile-topbar */}

      {scan && (
        <Suspense fallback={null}>
          <QrScanner knownRooms={ROOM_NAME}
            title={scan.forBooking && booking ? `Scan the QR on ${booking.roomName}'s door` : "Scan a room's door QR"}
            hint={scan.forBooking ? `Check in within the ${CHECKIN_GRACE_MIN} min grace time or the room goes back to everyone.` : undefined}
            onRoom={onScannedRoom}
            onClose={() => setScan(null)}
            onFallback={scan.forBooking && booking ? () => { const id = booking.roomId; setScan(null); checkIn(id, "tap"); } : undefined} />
        </Suspense>
      )}
      {showNotifs && (
        <div style={{ margin: "0 18px 10px", background: "#120F1E", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 16, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {!currentUser.isDemo && <div style={{ fontSize: 12.5, color: "#A39CC4", lineHeight: 1.5 }}>No notifications yet. Book a room or add your timetable and updates will show up here.</div>}
          {currentUser.isDemo && (ROLE_NOTIFS[role] || ROLE_NOTIFS.student).map((n) => (
            <div key={n.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <Sparkles size={13} color="#E9E3FF" style={{ marginTop: 2, flexShrink: 0 }} />
              <div><div style={{ fontSize: 13, lineHeight: 1.4 }}>{n.text}</div><div style={{ fontSize: 10.5, color: "#857DA8", marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>{n.time}</div></div>
            </div>
          ))}
        </div>
      )}

      {booking && (
        <div style={{ margin: "0 18px 14px", background: "linear-gradient(180deg, #F1ECFF, #A78BFA)", color: "#0A0812", boxShadow: "0 1px 0 rgba(255,255,255,.5) inset, 0 10px 30px rgba(0,0,0,.45)", borderRadius: 16, padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(10,8,18,0.6)", fontFamily: "'JetBrains Mono', monospace" }}>RESERVED BY YOU</div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 15 }}>{booking.roomName}</div>
            {booking.checkInBy && !booking.checkedIn && (
              <div style={{ fontSize: 11, fontWeight: 700, color: "#5B2A00", marginTop: 2 }}>Check in within {fmt(Math.max(0, Math.round((booking.checkInBy - nowTick) / 1000)))} · door QR</div>
            )}
            {booking.checkedIn && <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(10,8,18,0.7)", marginTop: 2 }}>✓ Checked in</div>}
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, fontWeight: 500 }}>{fmt(booking.secondsLeft)}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 4, justifyContent: "flex-end" }}>
              <button onClick={() => { setMapFocusId(booking.roomId); setTab("map"); }} aria-label="Directions to my room" style={{ fontSize: 11, background: "rgba(10,8,18,0.12)", border: "1px solid rgba(10,8,18,0.35)", color: "#0A0812", borderRadius: 8, padding: "4px 8px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3, fontWeight: 600 }}><Navigation size={11} /> Go</button>
              {booking.checkInBy && !booking.checkedIn && (
                <button onClick={() => setScan({ forBooking: true })} style={{ fontSize: 11, background: "#0A0812", border: "none", color: "#C4B5FD", borderRadius: 8, padding: "4px 8px", cursor: "pointer", fontWeight: 700, whiteSpace: "nowrap" }}><ScanLine size={11} style={{ marginRight: 4, verticalAlign: -2 }} />Check in</button>
              )}
              <button onClick={endEarly} style={{ fontSize: 11, background: "#0A0812", border: "none", color: "#F4F1FF", borderRadius: 8, padding: "4px 8px", cursor: "pointer", whiteSpace: "nowrap" }}>I'm out</button>
            </div>
          </div>
        </div>
      )}

      {checkins.mine && !(booking && booking.roomId === checkins.mine.roomId) && (
        <div style={{ margin: "0 18px 14px", background: "rgba(61,220,151,0.08)", border: "1px solid rgba(61,220,151,0.3)", borderRadius: 14, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 12.5, color: "#E9E3FF" }}>
            <span style={{ color: "#3DDC97", fontWeight: 700 }}>✓ Checked in</span> at <b>{ROOM_NAME[checkins.mine.roomId] || checkins.mine.roomId}</b>
            {checkins.mine.method === "qr" && <span style={{ color: "#A39CC4" }}> · via door QR</span>}
          </div>
          <button onClick={() => checkOut()} style={{ fontSize: 11, background: "rgba(196,181,253,0.08)", border: "1px solid rgba(196,181,253,0.2)", color: "#E9E3FF", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}>Check out</button>
        </div>
      )}

      {!online && (
        <div role="status" style={{ margin: "0 18px 12px", background: "rgba(245,181,68,0.1)", border: "1px solid rgba(245,181,68,0.35)", color: "#F5B544", borderRadius: 12, padding: "8px 12px", fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
          <WifiOff size={13} /> You're offline. Rooms shown from the last update; booking and AI search come back when you reconnect.
        </div>
      )}

      <ErrorBoundary resetKey={view}>
      <Suspense fallback={<ScreenLoading />}>
      <div className="gs-tab-wrap">
      {view === "find" && (
        <div style={{ padding: "0 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          <GhostSlotInfo />

          <WhereAmI places={places} location={you} onSet={setYou} onClear={() => setYou(null)} />

          <div style={{ background: "#120F1E", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 16, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: "#D2C8F5" }}>
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
                style={{ width: "100%", background: "#07060C", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 12, padding: "11px 46px 11px 12px", color: "#F4F1FF", fontSize: 13, outline: "none", opacity: aiStatus === "loading" ? 0.6 : 1 }}
              />
              <button onClick={() => runQuery(query)} disabled={aiStatus === "loading"} style={{ position: "absolute", right: 6, top: 6, background: "#C4B5FD", border: "none", borderRadius: 8, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: aiStatus === "loading" ? "default" : "pointer" }}>
                {aiStatus === "loading" ? <RefreshCw size={14} color="#07060C" className="gs-spin" /> : <ArrowRight size={14} color="#07060C" />}
              </button>
            </div>
            <button onClick={runDemoQuery} style={{ alignSelf: "flex-start", background: "none", border: "none", color: "#857DA8", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
              <Sparkle size={11} /> Try: "{DEMO_QUERY}"
            </button>
            {understood.length > 0 && (
              <div style={{ fontSize: 11.5, color: "#E9E3FF", background: "rgba(167,139,250,0.08)", borderRadius: 10, padding: "8px 10px" }}>
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
              <button key={String(c.id)} onClick={() => setPrefs((p) => ({ ...p, category: c.id }))} style={{ flexShrink: 0, background: prefs.category === c.id ? "#E9E3FF" : "#120F1E", color: prefs.category === c.id ? "#07060C" : "#F4F1FF", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 999, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                {c.label}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
            {DURATION_PRESETS.map((d) => (
              <button key={d} onClick={() => setPrefs((p) => ({ ...p, duration: d }))} style={{ flexShrink: 0, background: prefs.duration === d ? "#C4B5FD" : "#120F1E", color: prefs.duration === d ? "#0A0812" : "#F4F1FF", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                {d} min
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
            {LOCATIONS.map((loc) => (
              <button key={loc} onClick={() => setPrefs((p) => ({ ...p, location: loc }))} style={{ flexShrink: 0, background: prefs.location === loc ? "#E9E3FF" : "#120F1E", color: prefs.location === loc ? "#07060C" : "#F4F1FF", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                <Building2 size={11} /> {loc === "Anywhere" ? "Anywhere" : `Near ${loc.replace(" Block", "").replace("Central ", "")}`}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
            <button onClick={() => setMatchMyFreeTime((q) => !q)} style={{ flexShrink: 0, background: matchMyFreeTime ? "#C4B5FD" : "#120F1E", color: matchMyFreeTime ? "#0A0812" : "#F4F1FF", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 999, padding: "7px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              <CalendarClock size={11} style={{ marginRight: 4, verticalAlign: -2 }} />my free time
            </button>
            <button onClick={() => setPrefs((p) => ({ ...p, vibe: p.vibe === "quiet" ? null : "quiet" }))} style={{ flexShrink: 0, background: prefs.vibe === "quiet" ? "#E9E3FF" : "#120F1E", color: prefs.vibe === "quiet" ? "#07060C" : "#F4F1FF", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 999, padding: "7px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              <Snowflake size={11} style={{ marginRight: 4, verticalAlign: -2 }} />quiet
            </button>
            {[["plug", "charging"], ["wifi+", "wi-fi"]].map(([tag, label]) => (
              <button key={tag} onClick={() => toggleRequirement(tag)} style={{ flexShrink: 0, background: prefs.requirements.includes(tag) ? "#E9E3FF" : "#120F1E", color: prefs.requirements.includes(tag) ? "#07060C" : "#F4F1FF", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 999, padding: "7px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                {label}
              </button>
            ))}
            <button onClick={() => setShowFilters(true)} style={{ flexShrink: 0, marginLeft: "auto", background: activeFilterCount > 0 ? "#C4B5FD" : "#1A1630", color: activeFilterCount > 0 ? "#0A0812" : "#CFC7EC", border: activeFilterCount > 0 ? "none" : "1px solid rgba(196,181,253,0.12)", borderRadius: 999, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
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
            <CsiDevDashboard csi={csiStatus} mesh={meshStatus} onClose={() => setShowCsiDevDashboard(false)} />
          )}

          {matchMyFreeTime && myAvailableNow < (prefs.duration || 30) && (
            <div style={{ fontSize: 12, color: "#FF8B8B", background: "rgba(255,107,107,0.08)", borderRadius: 12, padding: 10 }}>
              You only have {fmtMin(myAvailableNow)} free right now per your timetable — that's short of your {prefs.duration || 30} min ask.
            </div>
          )}

          {bestMatch ? (
            <div style={{ background: "linear-gradient(180deg, #1B1732, #100D1B)", border: "1px solid rgba(167,139,250,0.35)", borderRadius: 18, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#E9E3FF", display: "flex", alignItems: "center", gap: 4 }}>
                  <Sparkles size={13} /> BEST MATCH
                </div>
                <Pill tone="lime">{bestMatch.score}% match</Pill>
              </div>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 19 }}>{bestMatch.room.name}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {getRecommendationExplanation(bestMatch.room, bestMatch.status, prefs).map((line, i) => (
                  <div key={i} style={{ fontSize: 12.5, color: "#CFC7EC", display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <CheckCircle2 size={13} color="#E9E3FF" style={{ marginTop: 1, flexShrink: 0 }} /> {line}
                  </div>
                ))}
              </div>
              {bestMatch.room.bookable !== false && bestMatch.status.free && !(booking && booking.roomId === bestMatch.room.id) && (
                <button onClick={() => handleBook(bestMatch.room, bestMatch.status)} disabled={!!booking} style={{ background: booking ? "rgba(196,181,253,0.06)" : "#C4B5FD", color: booking ? "#857DA8" : "#07060C", border: "none", borderRadius: 12, padding: "11px 14px", fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, cursor: booking ? "not-allowed" : "pointer" }}>
                  {booking ? "end current booking first" : "Lock it in"}
                </button>
              )}
              <button onClick={() => { setMapFocusId(bestMatch.room.id); setTab("map"); }} style={{ background: "rgba(139,92,246,0.12)", color: "#E9E3FF", border: "1px solid rgba(139,92,246,0.4)", borderRadius: 12, padding: "10px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Navigation size={14} /> {you ? `Take me there · ${bestMatch.room.walk.replace(" walk", "")} from you` : "Show me the way"}
              </button>
            </div>
          ) : (
            <div style={{ background: "#120F1E", border: "1px solid rgba(255,107,107,0.3)", borderRadius: 16, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <AlertTriangle size={16} color="#FF8B8B" style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 12.5, color: "#CFC7EC" }}>No room matches everything you asked for right now. Closest options:</div>
              </div>
              {closestOptions.map(({ room, status, score }) => (
                <div key={room.id} style={{ background: "#1A1630", borderRadius: 12, padding: 10, fontSize: 12, color: "#CFC7EC" }}>
                  <b>{room.name}</b> — {score}% match, {status.free ? `free for ${fmtMin(status.freeFor)}` : status.closed ? `closed until ${status.busyUntil}` : `busy until ${status.busyUntil}`}, {room.walk}
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {prefs.location !== "Anywhere" && (
                  <button onClick={() => setPrefs((p) => ({ ...p, location: "Anywhere" }))} style={{ background: "#C4B5FD", color: "#07060C", border: "none", borderRadius: 999, padding: "6px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Expand location</button>
                )}
                {prefs.vibe && (
                  <button onClick={() => setPrefs((p) => ({ ...p, vibe: null }))} style={{ background: "#C4B5FD", color: "#07060C", border: "none", borderRadius: 999, padding: "6px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Remove vibe filter</button>
                )}
                {prefs.duration > 30 && (
                  <button onClick={() => setPrefs((p) => ({ ...p, duration: Math.max(30, p.duration - 30) }))} style={{ background: "#C4B5FD", color: "#07060C", border: "none", borderRadius: 999, padding: "6px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
                    <RefreshCw size={10} style={{ marginRight: 4, verticalAlign: -1 }} />Allow {Math.max(30, prefs.duration - 30)} min
                  </button>
                )}
                {matchMyFreeTime && (
                  <button onClick={() => setMatchMyFreeTime(false)} style={{ background: "#C4B5FD", color: "#07060C", border: "none", borderRadius: 999, padding: "6px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Ignore my free time</button>
                )}
              </div>
            </div>
          )}

          {alternatives.length > 0 && (
            <div>
              <div style={{ fontSize: 11.5, color: "#857DA8", fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>OTHER GOOD OPTIONS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {alternatives.map(({ room, status, score }) => (
                  <div key={room.id} style={{ background: "#120F1E", borderRadius: 12, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{room.name}</div>
                      <div style={{ fontSize: 11, color: "#857DA8" }}>{room.sensing === "wifi" ? statusMeta(room, status, prefs, null).label : status.free ? `free ${fmtMin(status.freeFor)}` : status.closed ? `closed till ${status.busyUntil}` : `busy till ${status.busyUntil}`} · {room.walk}</div>
                    </div>
                    <Pill tone="lime">{score}%</Pill>
                  </div>
                ))}
              </div>
            </div>
          )}

          {restOfList.length > 0 && (
            <div className="gs-room-grid" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 11.5, color: "#857DA8", fontFamily: "'JetBrains Mono', monospace", gridColumn: "1 / -1" }}>ALL ROOMS</div>
              {restOfList.map(({ room, status, score }) => (
                <RoomCard key={room.id} room={room} status={status} prefs={prefs} booking={booking} onBook={handleBook} hasActiveBooking={!!booking} scoreBadge={score} csi={room.csiEnabled ? csiStatus : undefined} mesh={room.csiEnabled ? meshStatus : undefined} door={room.csiEnabled ? doorStatus : undefined} onOpenDevDashboard={room.csiEnabled ? () => setShowCsiDevDashboard(true) : undefined} hereCount={checkins.counts[room.id] || 0} />
              ))}
            </div>
          )}
        </div>
      )}

      {view === "map" && (
        <div style={{ padding: "0 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          <WhereAmI compact places={places} location={you} onSet={setYou} onClear={() => setYou(null)} />
          <CampusMap
            rooms={roomsWithStatus}
            booking={booking}
            csi={meshStatus}
            onBook={role === "facilities" ? undefined : handleBook}
            onShowInFind={isStudent ? (room) => { setTab("find"); setPrefs((p) => ({ ...DEFAULT_PREFS, category: room.category, sortBy: p.sortBy })); } : undefined}
            you={you}
            onSetYou={setYou}
            places={places}
            focusId={mapFocusId}
            anchorsVersion={anchorsVersion}
          />
          {role === "facilities" && (
            <>
              <GpsCalibration places={places} onChanged={() => setAnchorsVersion((v) => v + 1)} />
              <DoorQrCodes rooms={ROOM_META} />
            </>
          )}
        </div>
      )}

      {view === "timetable" && (
        <div style={{ padding: "0 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setTtSubTab("mine")} style={{ flex: 1, background: ttSubTab === "mine" ? "#C4B5FD" : "#120F1E", color: ttSubTab === "mine" ? "#0A0812" : "#A39CC4", border: "none", borderRadius: 12, padding: "9px 0", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>{role === "faculty" ? "My teaching" : "My timetable"}</button>
            <button onClick={() => setTtSubTab("rooms")} style={{ flex: 1, background: ttSubTab === "rooms" ? "#C4B5FD" : "#120F1E", color: ttSubTab === "rooms" ? "#0A0812" : "#A39CC4", border: "none", borderRadius: 12, padding: "9px 0", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>Room timetables</button>
          </div>

          {ttSubTab === "mine" && (
            <>
              <div style={{ fontSize: 12.5, color: "#A39CC4" }}>{role === "faculty" ? "The classes you teach. GhostSlot warns you when an extra class would clash." : "Feed it your classes so it stops guessing when you're actually free."}</div>
              <CsvImport
                label={role === "faculty" ? "Bulk import your teaching timetable" : "Bulk import your timetable"}
                hint="CSV columns: day, start, end, subject. Times as HH:MM, 24-hour."
                onFile={importMyCSV}
                onTemplate={() => downloadTemplate("mine")}
                summary={myCsvSummary}
              />
              <div style={{ textAlign: "center", fontSize: 10.5, color: "#4E4670" }}>— or add one manually —</div>
              <SlotForm day={day} onAdd={addMySlot} roomOptions={null} existingSlotsFor={() => mySlots} />
              <div style={{ fontSize: 11.5, color: "#857DA8", fontFamily: "'JetBrains Mono', monospace" }}>{day.toUpperCase()}'S CLASSES</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {mySlots.filter((s) => s.day === day).sort((a, b) => toMin(a.start) - toMin(b.start)).map((s) => (
                  <div key={s.id} style={{ background: "#120F1E", borderRadius: 12, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div><div style={{ fontSize: 13, fontWeight: 600 }}>{s.subject}</div><div style={{ fontSize: 11.5, color: "#857DA8", fontFamily: "'JetBrains Mono', monospace" }}>{s.start}–{s.end}</div></div>
                    <button onClick={() => removeMySlot(s.id)} style={{ background: "none", border: "none", cursor: "pointer" }}><Trash2 size={14} color="#857DA8" /></button>
                  </div>
                ))}
                {mySlots.filter((s) => s.day === day).length === 0 && <div style={{ fontSize: 12.5, color: "#857DA8" }}>No classes logged for {day}. Free bird.</div>}
              </div>
              <div style={{ fontSize: 11.5, color: "#857DA8", fontFamily: "'JetBrains Mono', monospace", marginTop: 4 }}>YOUR FREE WINDOWS</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {myFreeWindows.length ? myFreeWindows.map(([s, e], i) => <Pill key={i} tone="lime">{toHHMM(s)}–{toHHMM(e)}</Pill>) : <span style={{ fontSize: 12.5, color: "#857DA8" }}>Booked solid. Rough day.</span>}
              </div>
            </>
          )}

          {ttSubTab === "rooms" && (
            <>
              <div style={{ fontSize: 12.5, color: "#A39CC4" }}>Log what a room's booked for and GhostSlot figures out the rest.</div>
              <CsvImport
                label="Bulk import room timetables"
                hint="CSV columns: room, day, start, end, subject. Room = exact room ID or name, e.g. A2-104."
                onFile={importRoomCSV}
                onTemplate={() => downloadTemplate("rooms")}
                summary={roomCsvSummary}
              />
              <div style={{ textAlign: "center", fontSize: 10.5, color: "#4E4670" }}>— or add one manually —</div>
              <SlotForm day={day} onAdd={addRoomSlot} roomOptions={TIMETABLE_ROOMS} existingSlotsFor={(roomId) => roomSlots[roomId] || []} />
              {TIMETABLE_ROOMS.map((r) => (
                <div key={r.id}>
                  <div style={{ fontSize: 11.5, color: "#857DA8", fontFamily: "'JetBrains Mono', monospace", marginTop: 6, marginBottom: 4 }}>{r.name.toUpperCase()} · {day.toUpperCase()}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {(roomSlots[r.id] || []).filter((s) => s.day === day).sort((a, b) => toMin(a.start) - toMin(b.start)).map((s) => (
                      <div key={s.id} style={{ background: "#120F1E", borderRadius: 12, padding: "9px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div><div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.subject}</div><div style={{ fontSize: 11, color: "#857DA8", fontFamily: "'JetBrains Mono', monospace" }}>{s.start}–{s.end}</div></div>
                        <button onClick={() => removeRoomSlot(r.id, s.id)} style={{ background: "none", border: "none", cursor: "pointer" }}><Trash2 size={13} color="#857DA8" /></button>
                      </div>
                    ))}
                    {(roomSlots[r.id] || []).filter((s) => s.day === day).length === 0 && <div style={{ fontSize: 12, color: "#4E4670" }}>nothing booked — open all {day}</div>}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {view === "predict" && (
        <div style={{ padding: "0 18px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16 }}>AI-assisted shortage forecast</div>
            <div style={{ fontSize: 12, color: "#A39CC4", marginTop: 2 }}>Forecast combines timetable occupancy, historical utilization and current demand signals.</div>
          </div>
          <div style={{ background: "#120F1E", borderRadius: 16, padding: 12, height: 190 }}>
            <ForecastChart data={forecastData} />
          </div>
          <div style={{ background: "#120F1E", border: "1px solid rgba(255,107,107,0.25)", borderRadius: 14, padding: 12, fontSize: 12.5, color: "#CFC7EC", display: "flex", gap: 8 }}>
            <Sparkles size={16} color="#FF8B8B" style={{ flexShrink: 0 }} />
            <span><b style={{ color: "#FF8B8B" }}>{peakSlot.hour} is about to be a bloodbath</b> — {peakSlot.risk}% shortage risk. Book your spot before then or accept your fate on the canteen steps.</span>
          </div>

          <div style={{ background: "#120F1E", borderRadius: 16, padding: 14, border: "1px solid rgba(196,181,253,0.07)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#E9E3FF", fontFamily: "'JetBrains Mono', monospace", marginBottom: 10 }}>CAMPUS CAPACITY</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <div style={{ flex: "1 1 40%" }}><div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{TIMETABLE_ROOMS.length}</div><div style={{ fontSize: 10.5, color: "#A39CC4" }}>rooms tracked</div></div>
              <div style={{ flex: "1 1 40%" }}><div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{avgUtil}%</div><div style={{ fontSize: 10.5, color: "#A39CC4" }}>avg utilization</div></div>
              <div style={{ flex: "1 1 40%" }}><div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{underusedCount}</div><div style={{ fontSize: 10.5, color: "#A39CC4" }}>underused rooms</div></div>
              <div style={{ flex: "1 1 40%" }}><div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{peakSlot.hour}</div><div style={{ fontSize: 10.5, color: "#A39CC4" }}>peak shortage</div></div>
            </div>
            <div style={{ fontSize: 12, color: "#CFC7EC", marginTop: 10, lineHeight: 1.4 }}>
              <Percent size={11} style={{ marginRight: 4, verticalAlign: -1 }} color="#E9E3FF" />
              <b style={{ color: "#E9E3FF" }}>{100 - avgUtil}%</b> of tracked room-capacity sits unused in an average week. Use what's already built before asking for more.
            </div>
          </div>

          <div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16 }}>Most ghosted rooms</div>
            <div style={{ fontSize: 12, color: "#A39CC4", marginTop: 2, marginBottom: 8 }}>These spaces have capacity that's frequently left unused.</div>
            <div style={{ background: "#120F1E", borderRadius: 16, padding: 12, height: 160 }}>
              <UnderusedChart data={underused} />
            </div>
          </div>
        </div>
      )}

      {view === "twin" && <Twin showLog={role !== "facilities"} />}

      {view === "classes" && (
        <FacultyHome user={currentUser} day={day} time={time} mySlots={mySlots} rooms={roomsWithStatus} booking={booking}
          onBook={(room, duration, subject) => { const st = roomsWithStatus.find((x) => x.room.id === room.id)?.status; if (st?.free) handleBook(room, st, duration, subject); }}
          onOpenTimetable={() => { setTab("timetable"); setTtSubTab("mine"); }} />
      )}

      {view === "ops" && <OpsHome user={currentUser} onOpenAnalytics={() => setTab("twin")} />}

      {view === "squad" && (
        <div style={{ padding: "0 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12.5, color: "#A39CC4" }}>People in your batch who are also free right now, allegedly.</div>
          {!currentUser.isDemo && (
            <div style={{ background: "#120F1E", borderRadius: 16, padding: 14, border: "1px dashed rgba(196,181,253,0.18)", fontSize: 12.5, color: "#A39CC4", lineHeight: 1.5 }}>
              Your squad is empty for now. Once your batchmates join GhostSlot and add their timetables, the ones who are free when you are show up here.
            </div>
          )}
          {currentUser.isDemo && SQUAD.map((s) => (
            <div key={s.name} style={{ background: "#120F1E", borderRadius: 16, padding: 13, display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid rgba(196,181,253,0.07)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: "#221C3B", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 13, color: "#D2C8F5" }}>{s.init}</div>
                <div><div style={{ fontWeight: 600, fontSize: 13.5 }}>{s.name}</div><div style={{ fontSize: 11.5, color: "#857DA8" }}>{s.free} · {s.slot}</div></div>
              </div>
              <button onClick={() => ping(s.name)} disabled={pinged[s.name]} style={{ background: pinged[s.name] ? "rgba(167,139,250,0.15)" : "#C4B5FD", color: pinged[s.name] ? "#E9E3FF" : "#07060C", border: "none", borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: pinged[s.name] ? "default" : "pointer" }}>
                {pinged[s.name] ? "pinged ✓" : "ping"}
              </button>
            </div>
          ))}
        </div>
      )}

      {view === "profile" && (
        <div style={{ padding: "0 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 17 }}>{currentUser.name}</div>
              <div style={{ fontSize: 11.5, color: "#857DA8", fontFamily: "'JetBrains Mono', monospace" }}>{currentUser.roll} · {ROLE_META[currentUser.role]?.label || "Student"}{currentUser.department ? ` · ${currentUser.department}` : ""}</div>
              <div style={{ fontSize: 11.5, color: "#A39CC4", marginTop: 3 }}>{ROLE_META[currentUser.role]?.can}</div>
            </div>
            <button onClick={() => handleLogout()} style={{ background: "#120F1E", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 10, padding: "8px 10px", display: "flex", alignItems: "center", gap: 5, color: "#FF8B8B", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <LogOut size={13} /> logout
            </button>
          </div>
          {role === "faculty" && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {[[currentUser.department || "—", "department"], [mySlots.length, "classes a week on your timetable"], [extraBooked, "extra classes booked this session"]].map(([v, l]) => (
                <div key={l} style={{ flex: "1 1 120px", background: "#120F1E", borderRadius: 14, padding: 12, border: "1px solid rgba(196,181,253,0.07)" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{v}</div>
                  <div style={{ fontSize: 11, color: "#A39CC4" }}>{l}</div>
                </div>
              ))}
            </div>
          )}
          {role === "facilities" && <StaffWorkLog department={currentUser.department} />}
          {!isStudent ? null : currentUser.isMinor ? (
            <div style={{ background: "#120F1E", borderRadius: 14, padding: 12, border: "1px solid rgba(196,181,253,0.07)", fontSize: 12, color: "#A39CC4", lineHeight: 1.5 }}>
              Room karma, badges and booking-behaviour stats are switched off for under-18 accounts. India's DPDP Act doesn't allow behavioural tracking of children. Everything else works the same.
            </div>
          ) : (<>
          <div style={{ background: "linear-gradient(180deg, #1E1936, #100D1B)", borderRadius: 18, padding: 18, border: "1px solid rgba(196,181,253,0.07)" }}>
            <div style={{ fontSize: 11.5, color: "#A39CC4", fontFamily: "'JetBrains Mono', monospace" }}>ROOM KARMA</div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 34, fontWeight: 700, color: "#E9E3FF" }}>{karma}</div>
            <div style={{ fontSize: 12, color: "#A39CC4", marginTop: 2 }}>{currentUser.isDemo ? "Top 12% of students who actually leave on time." : karma === 0 ? "Fresh start. Check in on time (+2) and leave early (+5) to build it up." : "Keep showing up on time to climb."}</div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1, background: "#120F1E", borderRadius: 14, padding: 12, border: "1px solid rgba(196,181,253,0.07)" }}>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{mySlots.length}</div>
              <div style={{ fontSize: 11, color: "#A39CC4" }}>classes logged</div>
            </div>
            <div style={{ flex: 1, background: "#120F1E", borderRadius: 14, padding: 12, border: "1px solid rgba(196,181,253,0.07)" }}>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{stats.ghosted}</div>
              <div style={{ fontSize: 11, color: "#A39CC4" }}>{stats.ghosted === 0 ? "ghosted bookings (clean record)" : stats.ghosted === 1 ? "ghosted booking (we see you)" : "ghosted bookings (we see you)"}</div>
            </div>
          </div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 15 }}>Badges</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {stats.early > 0 && <Pill tone="lime"><CheckCircle2 size={10} style={{ marginRight: 4, verticalAlign: -1 }} />early checkout x{stats.early}</Pill>}
            {stats.onTime > 0 && <Pill><Radar size={10} style={{ marginRight: 4, verticalAlign: -1 }} />showed up on time x{stats.onTime}</Pill>}
            {currentUser.isDemo && <Pill><Radar size={10} style={{ marginRight: 4, verticalAlign: -1 }} />library regular</Pill>}
            {currentUser.isDemo && <Pill tone="coral"><Flame size={10} style={{ marginRight: 4, verticalAlign: -1 }} />1pm survivor</Pill>}
            {!currentUser.isDemo && stats.early === 0 && stats.onTime === 0 && <div style={{ fontSize: 12, color: "#A39CC4" }}>No badges yet. Book a room and check in on time to earn your first one.</div>}
          </div>
          </>)}

          {/* Security & privacy — what we hold about you, and the controls */}
          <div style={{ background: "linear-gradient(180deg, #1B1732, #100D1B)", border: "1px solid rgba(196,181,253,0.09)", borderRadius: 18, padding: 16, display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 1px 0 rgba(196,181,253,.04) inset" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 12, background: "linear-gradient(180deg, #F1ECFF, #A78BFA)", display: "flex", alignItems: "center", justifyContent: "center" }}><ShieldCheck size={18} color="#0A0812" /></div>
              <div>
                <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 15 }}>Security &amp; privacy</div>
                <div style={{ fontSize: 11.5, color: "#A39CC4" }}>What GhostSlot holds about you, and your controls.</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ background: "rgba(61,220,151,0.08)", border: "1px solid rgba(61,220,151,0.22)", borderRadius: 12, padding: "10px 12px" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#3DDC97", display: "flex", alignItems: "center", gap: 5 }}><CheckCircle2 size={13} /> {currentUser.isMinor ? "Guardian approved" : "18+ verified"}</div>
                {currentUser.isMinor && currentUser.guardian && <div style={{ fontSize: 11, color: "#A39CC4", marginTop: 3 }}>by {currentUser.guardian.relation.toLowerCase()} {currentUser.guardian.name}{currentUser.guardian.consentAt ? ` · ${new Date(currentUser.guardian.consentAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}` : ""}. They can withdraw it from their link.</div>}
                {!currentUser.isMinor && <div style={{ fontSize: 11, color: "#A39CC4", marginTop: 3 }}>at signup{currentUser.ageCheckedAt ? ` · ${new Date(currentUser.ageCheckedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}` : ""}. Birth date not stored.</div>}
              </div>
              <div style={{ background: "rgba(196,181,253,0.03)", border: "1px solid rgba(196,181,253,0.07)", borderRadius: 12, padding: "10px 12px" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}><MonitorSmartphone size={13} /> {currentUser.activeSessions || 1} active session{(currentUser.activeSessions || 1) === 1 ? "" : "s"}</div>
                <div style={{ fontSize: 11, color: "#A39CC4", marginTop: 3 }}>Secure httpOnly cookie, ends after 7 days.</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!currentUser.isDemo && <button onClick={() => handleLogout(true)} style={{ background: "#1A1630", border: "1px solid #322A50", color: "#F4F1FF", borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}><LogOut size={13} /> Sign out everywhere</button>}
              <button onClick={() => setShowPrivacy(true)} style={{ background: "#1A1630", border: "1px solid #322A50", color: "#F4F1FF", borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}><Info size={13} /> Privacy notice</button>
              {!currentUser.isDemo && <button onClick={() => { setDeleteOpen((o) => !o); setDeleteErr(""); }} style={{ background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.25)", color: "#FF8B8B", borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}><Trash2 size={13} /> Delete my account</button>}
            </div>
            {currentUser.isDemo && <div style={{ fontSize: 11.5, color: "#A39CC4" }}>This is a shared judges' demo account, so <i>Sign out everywhere</i> and <i>Delete my account</i> are switched off. Sign up to try them.</div>}
            {deleteOpen && !currentUser.isDemo && (
              <div style={{ background: "rgba(255,107,107,0.06)", border: "1px solid rgba(255,107,107,0.2)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 12.5, color: "#CFC7EC" }}>This permanently deletes your account and signs you out on every device. Enter your password to confirm.</div>
                <input type="password" autoComplete="current-password" value={deletePw} onChange={(e) => setDeletePw(e.target.value)} placeholder="password" maxLength={128} style={{ background: "#0B0914", border: "1px solid #322A50", borderRadius: 10, padding: "9px 10px", color: "#F4F1FF", fontSize: 13, outline: "none" }} />
                {deleteErr && <div role="alert" style={{ fontSize: 12, color: "#FF8B8B" }}>{deleteErr}</div>}
                <button onClick={deleteAccount} disabled={!deletePw} style={{ background: "#FF6B6B", color: "#0A0812", border: "none", borderRadius: 10, padding: "9px 12px", fontSize: 12.5, fontWeight: 700, cursor: deletePw ? "pointer" : "not-allowed", opacity: deletePw ? 1 : 0.5 }}>Delete permanently</button>
              </div>
            )}
          </div>
        </div>
      )}

      </div>{/* end gs-tab-wrap */}
      </Suspense>
      </ErrorBoundary>

      {toast && (
        <div style={{ position: "fixed", bottom: 92, left: "50%", transform: "translateX(-50%)", maxWidth: 400, width: "calc(100% - 36px)", background: "#1A1630", border: "1px solid rgba(196,181,253,0.1)", borderRadius: 14, padding: "10px 14px", fontSize: 12.5, display: "flex", alignItems: "center", gap: 8, zIndex: 20, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
          <Sparkles size={13} color="#E9E3FF" style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{toast}</span>
          <button onClick={() => setToast(null)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={13} color="#857DA8" /></button>
        </div>
      )}

      </div>{/* end gs-main */}

      {role !== "facilities" && <Suspense fallback={null}><CampusAI buildContext={buildCampusContext} onViewSpace={handleViewSpaceFromAI} /></Suspense>}
      {showPrivacy && <PrivacyNotice onClose={() => setShowPrivacy(false)} />}

      <nav className="gs-bottom-nav" style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 460, background: "#100D1B", borderTop: "1px solid rgba(196,181,253,0.07)", display: "flex", padding: "10px 4px 14px", zIndex: 10 }}>
        {navItems.map((n) => {
          const Icon = n.icon;
          const active = view === n.id;
          return (
            <button key={n.id} onClick={() => setTab(n.id)} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, color: active ? "#E9E3FF" : "#857DA8" }}>
              <Icon size={18} />
              <span style={{ fontSize: 9.5, fontWeight: 600 }}>{n.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
