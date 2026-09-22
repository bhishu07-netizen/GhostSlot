// Standalone sanity test of the pure logic (copied verbatim from App.jsx)
// so we can run it in plain Node without a browser/React harness.

const ROOM_META = [
  { id: "A2-104", name: "A2 · 104", block: "A2 Block", floor: "1st floor", capacity: 60, walk: "3 min walk", tags: ["plug", "ac"], vibe: "quiet", util7d: 22 },
  { id: "D-Block-LT3", name: "D Block · LT-3", block: "D Block", floor: "Ground floor", capacity: 120, walk: "7 min walk", tags: ["plug"], vibe: "loud", util7d: 61 },
  { id: "CSE-Lab-9", name: "CSE Block · Lab 9", block: "CSE Block", floor: "2nd floor", capacity: 40, walk: "1 min walk", tags: ["plug", "ac", "wifi+"], vibe: "quiet", util7d: 12 },
  { id: "A1-212", name: "A1 · 212", block: "A1 Block", floor: "2nd floor", capacity: 70, walk: "5 min walk", tags: ["ac"], vibe: "medium", util7d: 44 },
  { id: "Library-Pod-4", name: "Library · Pod 4", block: "Central Library", floor: "3rd floor", capacity: 8, walk: "6 min walk", tags: ["plug", "wifi+", "ac"], vibe: "silent", util7d: 8 },
  { id: "D-Block-210", name: "D Block · 210", block: "D Block", floor: "2nd floor", capacity: 55, walk: "8 min walk", tags: ["plug"], vibe: "medium", util7d: 33 },
];
const SEED_ROOM_SLOTS = {
  "A2-104": [{ day: "Mon", start: "09:00", end: "10:30" }, { day: "Mon", start: "12:00", end: "13:00" }],
  "D-Block-LT3": [{ day: "Mon", start: "10:30", end: "13:00" }],
  "CSE-Lab-9": [{ day: "Mon", start: "15:00", end: "16:00" }],
  "A1-212": [{ day: "Mon", start: "09:00", end: "11:00" }, { day: "Mon", start: "15:00", end: "17:00" }],
  "Library-Pod-4": [],
  "D-Block-210": [{ day: "Mon", start: "13:00", end: "14:30" }],
};
const CAMPUS_START = "09:00", CAMPUS_END = "17:00";

function toMin(hhmm) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }
function busyIntervals(slots, day) {
  const todays = slots.filter((s) => s.day === day).map((s) => [toMin(s.start), toMin(s.end)]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of todays) {
    if (merged.length && s <= merged[merged.length - 1][1]) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    else merged.push([s, e]);
  }
  return merged;
}
function roomStatus(slots, day, nowMin) {
  const busy = busyIntervals(slots, day);
  const current = busy.find(([s, e]) => nowMin >= s && nowMin < e);
  if (current) return { free: false, busyUntil: current[1] };
  const next = busy.find(([s]) => s > nowMin);
  const until = next ? next[0] : toMin(CAMPUS_END);
  return { free: true, freeFor: Math.max(0, until - nowMin) };
}

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
  for (const key of Object.keys(vibeMap)) { if (new RegExp(`\\b${key}\\b`).test(q)) { result.vibe = vibeMap[key]; break; } }
  const locationMap = [[/\bcse\b/, "CSE Block"], [/\blibrary\b/, "Central Library"], [/\ba ?1\b|a1 block/, "A1 Block"], [/\ba ?2\b|a2 block/, "A2 Block"], [/\bd block\b|block d\b/, "D Block"]];
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

const VIBE_EQUIVALENTS = { quiet: ["quiet", "silent"], silent: ["silent"], medium: ["medium"], loud: ["loud", "medium"] };
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
  const utilScore = Math.max(0, 1 - room.util7d / 100);
  let capacityScore = 0.8;
  if (prefs.capacity) capacityScore = room.capacity >= prefs.capacity ? 1 : 0.15;
  const weights = { duration: 0.35, requirements: 0.25, distance: 0.15, vibe: 0.10, util: 0.10, capacity: 0.05 };
  const raw = weights.duration * durationScore + weights.requirements * requirementsScore + weights.distance * distanceScore + weights.vibe * vibeScore + weights.util * utilScore + weights.capacity * capacityScore;
  return Math.round(raw * 100);
}

// ---- tests ----
let failures = 0;
function check(name, cond) { console.log((cond ? "PASS " : "FAIL ") + name); if (!cond) failures++; }

const DEMO_QUERY = "I need a quiet place near CSE for 90 minutes with charging.";
const parsed = parseNaturalLanguageQuery(DEMO_QUERY);
console.log("parsed:", parsed);
check("duration == 90", parsed.duration === 90);
check("vibe == quiet", parsed.vibe === "quiet");
check("location == CSE Block", parsed.location === "CSE Block");
check("requirements includes plug", parsed.requirements.includes("plug"));

const p2 = parseNaturalLanguageQuery("big room for 50");
check("capacity == 50 (not confused with duration)", p2.capacity === 50 && p2.duration === null);

const p3 = parseNaturalLanguageQuery("I have 1 hour free");
check("'1 hour' parses to 60 min", p3.duration === 60);

const prefs = { duration: parsed.duration, location: parsed.location, vibe: parsed.vibe, requirements: parsed.requirements, capacity: null };
const nowMin = toMin("11:15");
const day = "Mon";
const scores = ROOM_META.map((r) => {
  const status = roomStatus(SEED_ROOM_SLOTS[r.id] || [], day, nowMin);
  return { name: r.name, id: r.id, score: calculateRoomScore(r, status, prefs), status };
}).sort((a, b) => b.score - a.score);
console.log("scores:", scores.map((s) => `${s.name}: ${s.score}%`));
check("CSE Lab 9 scores highest for the demo query", scores[0].id === "CSE-Lab-9");
check("CSE Lab 9 scores meaningfully above A2-104", scores[0].score - scores.find((s) => s.id === "A2-104").score >= 15);

// duration-aware "fits my free time" logic
function freeWindows(slots, day) {
  const busy = busyIntervals(slots, day);
  const start = toMin(CAMPUS_START), end = toMin(CAMPUS_END);
  const free = []; let cursor = start;
  for (const [s, e] of busy) { if (s > cursor) free.push([cursor, Math.min(s, end)]); cursor = Math.max(cursor, e); }
  if (cursor < end) free.push([cursor, end]);
  return free.filter(([s, e]) => e > s);
}
function getAvailableDuration(windows, atMin) { const w = windows.find(([s, e]) => atMin >= s && atMin < e); return w ? w[1] - atMin : 0; }
const mySlots = [{ day: "Mon", start: "09:00", end: "10:00" }, { day: "Mon", start: "10:00", end: "11:00" }, { day: "Mon", start: "13:00", end: "14:00" }];
const myWindows = freeWindows(mySlots, "Mon");
check("student free windows include 11:00-13:00", myWindows.some(([s, e]) => s === toMin("11:00") && e === toMin("13:00")));
check("getAvailableDuration at 11:15 == 105 min", getAvailableDuration(myWindows, toMin("11:15")) === 105);
check("90 min request fits in that window", getAvailableDuration(myWindows, toMin("11:15")) >= 90);

const a2Status = roomStatus(SEED_ROOM_SLOTS["A2-104"], "Mon", toMin("11:15"));
check("A2-104 free but only 45 min (not enough for 90 min ask)", a2Status.free && a2Status.freeFor === 45);

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
