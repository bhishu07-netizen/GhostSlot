// ─────────────────────────────────────────────────────────────────────────────
// Whole-campus spaces for GhostSlot: food, sports and hangout spots, plus
// the campus map layout. Classrooms stay in App.jsx (they run on timetables).
//
// HOW EACH SPACE IS SENSED
//   timetable : classrooms/labs, "free" comes from the timetable + bookings
//   wifi      : open spaces (food court, cafés, courts, library). "How busy"
//               comes from the number of devices on the nearby campus Wi-Fi
//               access points, mapped to the space.
//   csi       : Demo Room, ESP32-S3 Wi-Fi CSI pair (real hardware path)
//
// PROTOTYPE NOTE: campus Wi-Fi counts aren't connected yet, so crowdAt()
// below SIMULATES them with a realistic daily pattern per kind of place.
// Swap crowdAt() for the live AP feed later; nothing else has to change.
//
// Names are real CU places (from blog.cuchd.in). Opening hours, capacities
// and map positions are DEMO VALUES. Correct them here, in one place.
// ─────────────────────────────────────────────────────────────────────────────

export const CATEGORIES = [
  { id: null, label: "All" },
  { id: "study", label: "Study" },
  { id: "food", label: "Food" },
  { id: "sports", label: "Sports" },
  { id: "hangout", label: "Hangout" },
];

// x/y are positions on the schematic map (viewBox 1000 × 640).
export const CAMPUS_SPACES = [
  // ── Food ──────────────────────────────────────────────────────────────────
  { id: "food-republic", name: "Food Republic (FR)", block: "Food Republic", category: "food", type: "food_court", floor: "Ground floor",
    capacity: 400, walk: "5 min walk", tags: ["wifi+"], vibe: "loud", sensing: "wifi", bookable: false, hours: ["08:00", "22:00"], x: 620, y: 352,
    description: "The main food court: Domino's, Burger Singh, Major Chang's and Roll Express under one roof." },
  { id: "urban-king", name: "Urban King Café", block: "D6 (Star building)", category: "food", type: "cafe", floor: "D6",
    capacity: 60, walk: "4 min walk", tags: ["plug", "wifi+", "ac"], vibe: "medium", sensing: "wifi", bookable: false, hours: ["09:00", "21:00"], x: 700, y: 196,
    description: "Burgers, shawarma, pasta and thick shakes. A go-to for group hangouts." },
  { id: "food-scientists", name: "The Food Scientists", block: "D6 (Star building)", category: "food", type: "cafe", floor: "D6",
    capacity: 50, walk: "4 min walk", tags: ["plug", "wifi+"], vibe: "medium", sensing: "wifi", bookable: false, hours: ["09:00", "20:00"], x: 752, y: 222,
    description: "Cold coffee, juices, white-sauce pasta and momos. Good for project discussions." },
  { id: "chai-nagri", name: "Chai Nagri", block: "Main Ground", category: "food", type: "cafe", floor: "Opposite main ground",
    capacity: 40, walk: "6 min walk", tags: [], vibe: "medium", sensing: "wifi", bookable: false, hours: ["07:30", "22:00"], x: 588, y: 520,
    description: "Masala chai, elaichi tea and cookies. The classic meeting spot." },
  { id: "samosa-express", name: "The Samosa Express", block: "Main Ground", category: "food", type: "cafe", floor: "Near main ground",
    capacity: 25, walk: "7 min walk", tags: [], vibe: "loud", sensing: "wifi", bookable: false, hours: ["10:00", "19:00"], x: 868, y: 522,
    description: "Veg and cheese samosas. Quick, cheap tea-time snack." },
  { id: "trending-food", name: "Trending Food", block: "DSW", category: "food", type: "cafe", floor: "Opposite DSW",
    capacity: 50, walk: "6 min walk", tags: ["plug"], vibe: "medium", sensing: "wifi", bookable: false, hours: ["09:00", "21:00"], x: 790, y: 392,
    description: "Maggi, sandwiches, noodles and momos at student prices." },

  // ── Study (open-access, Wi-Fi sensed) ─────────────────────────────────────
  { id: "d6-library", name: "D6 Library (KRC)", block: "D6 (Star building)", category: "study", type: "library", floor: "D6",
    capacity: 180, walk: "4 min walk", tags: ["plug", "wifi+", "ac"], vibe: "silent", sensing: "wifi", bookable: false, hours: ["08:30", "20:00"], x: 726, y: 160,
    description: "Part of the Knowledge Resource Centre. Walk in, no booking. GhostSlot shows how full it is before you go." },

  // ── Sports ────────────────────────────────────────────────────────────────
  { id: "basketball-1", name: "Basketball Court 1", block: "Sports Complex", category: "sports", type: "court", floor: "Outdoor",
    capacity: 20, walk: "9 min walk", tags: [], vibe: "loud", sensing: "wifi", bookable: true, hours: ["06:00", "21:00"], x: 892, y: 150,
    description: "Full-size outdoor court with floodlights. Book a slot so your squad isn't left waiting." },
  { id: "basketball-2", name: "Basketball Court 2", block: "Sports Complex", category: "sports", type: "court", floor: "Outdoor",
    capacity: 20, walk: "9 min walk", tags: [], vibe: "loud", sensing: "wifi", bookable: true, hours: ["06:00", "21:00"], x: 946, y: 150,
    description: "Second outdoor court, usually freer than Court 1 in the evening rush." },
  { id: "badminton-hall", name: "Indoor Badminton Hall", block: "Sports Complex", category: "sports", type: "court", floor: "Indoor",
    capacity: 16, walk: "9 min walk", tags: ["ac"], vibe: "medium", sensing: "wifi", bookable: true, hours: ["06:00", "21:00"], x: 918, y: 236,
    description: "Indoor courts. Short slots, so book ahead at peak hours." },
  { id: "volleyball", name: "Volleyball Court", block: "Sports Complex", category: "sports", type: "court", floor: "Outdoor",
    capacity: 14, walk: "9 min walk", tags: [], vibe: "loud", sensing: "wifi", bookable: true, hours: ["06:00", "20:00"], x: 892, y: 318,
    description: "Sand-free outdoor court next to the basketball courts." },
  { id: "fitness-centre", name: "Fitness Centre", block: "Sports Complex", category: "sports", type: "gym", floor: "Indoor",
    capacity: 80, walk: "9 min walk", tags: ["ac"], vibe: "loud", sensing: "wifi", bookable: false, hours: ["05:30", "21:30"], x: 946, y: 318,
    description: "Gym and cardio floor. See the crowd before you carry your shaker all the way over." },
  { id: "main-ground", name: "Main Ground", block: "Main Ground", category: "sports", type: "ground", floor: "Outdoor",
    capacity: 300, walk: "7 min walk", tags: [], vibe: "loud", sensing: "wifi", bookable: false, hours: ["06:00", "20:00"], x: 720, y: 520,
    description: "Cricket and football ground. Open play, no booking." },

  // ── Hangout ───────────────────────────────────────────────────────────────
  { id: "fountain-area", name: "Fountain Area", block: "Fountain Area", category: "hangout", type: "outdoor", floor: "Outdoor",
    capacity: 150, walk: "3 min walk", tags: [], vibe: "medium", sensing: "wifi", bookable: false, hours: ["06:00", "23:00"], x: 552, y: 418,
    description: "Fountains and greenery between the academic blocks. Lit up in the evening." },
];

// Where the classroom rooms from App.jsx sit on the map.
export const ROOM_POSITIONS = {
  "A2-104": { x: 196, y: 300 },
  "A1-212": { x: 196, y: 420 },
  "CSE-Lab-9": { x: 380, y: 186 },
  "demo-room": { x: 426, y: 224 },
  "Library-Pod-4": { x: 370, y: 336 },
  "D-Block-LT3": { x: 640, y: 186 },
  "D-Block-210": { x: 668, y: 236 },
};

// Buildings and areas drawn on the schematic map.
export const MAP_ZONES = [
  { label: "A2 Block", x: 110, y: 256, w: 170, h: 90 },
  { label: "A1 Block", x: 110, y: 376, w: 170, h: 90 },
  { label: "CSE Block", x: 310, y: 140, w: 160, h: 110 },
  { label: "Central Library", x: 310, y: 282, w: 140, h: 86 },
  { label: "Kalpana Chawla Block", x: 310, y: 392, w: 160, h: 70 },
  { label: "D Block · D6 Star building", x: 600, y: 120, w: 200, h: 140 },
  { label: "Food Republic", x: 560, y: 304, w: 130, h: 86 },
  { label: "DSW", x: 740, y: 300, w: 80, h: 56 },
  { label: "Sports Complex", x: 860, y: 110, w: 120, h: 250, kind: "sport" },
  { label: "Main Ground", x: 620, y: 440, w: 220, h: 140, kind: "ground" },
];

// Optional: drop the official CU campus map at public/brand/campus-map.png and
// set this to "/brand/campus-map.png". It draws under the pins; then adjust
// the x/y values above so the pins sit on the right buildings.
export const CAMPUS_MAP_IMAGE = null;

// ── Opening hours ────────────────────────────────────────────────────────────
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
export function openWindow(space) {
  const [o, c] = space.hours || ["09:00", "17:00"];
  return { open: toMin(o), close: toMin(c), openLabel: o, closeLabel: c };
}

// ── Simulated Wi-Fi crowd (0–100 % of capacity) ─────────────────────────────
// Smooth daily curves per kind of place, plus a small stable per-place offset
// so neighbouring cafés don't move in lockstep.
const bump = (t, centre, width, height) => height * Math.exp(-((t - centre) ** 2) / (2 * width ** 2));
function seed(id) { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 997; return h / 997; }

export function crowdAt(space, day, minute) {
  const h = minute / 60;
  const weekend = day === "Sat" || day === "Sun";
  let c;
  switch (space.type) {
    case "food_court": c = 18 + bump(h, 13.2, 0.9, 72) + bump(h, 17.6, 0.9, 40) + bump(h, 9.0, 0.6, 18); break;
    case "cafe": c = 15 + bump(h, 11.5, 1.2, 45) + bump(h, 16.8, 1.3, 50) + bump(h, 13.2, 0.7, 25); break;
    case "library": c = 12 + bump(h, 14.5, 3.0, 62) + (weekend ? -10 : 0); break;
    case "court": c = 8 + bump(h, 7.0, 0.8, 30) + bump(h, 18.2, 1.3, 80) + (weekend ? 12 : 0); break;
    case "gym": c = 10 + bump(h, 7.0, 1.0, 55) + bump(h, 18.5, 1.4, 65); break;
    case "ground": c = 5 + bump(h, 17.8, 1.2, 55) + (weekend ? 15 : 0); break;
    default: c = 10 + bump(h, 18.8, 1.5, 55) + bump(h, 13.0, 1.0, 25);
  }
  if (weekend && (space.type === "food_court" || space.type === "cafe")) c *= 0.7;
  c += (seed(space.id) - 0.5) * 14;
  return Math.max(2, Math.min(98, Math.round(c)));
}

export function crowdLabel(pct) {
  if (pct < 40) return { label: "quiet", tone: "lime" };
  if (pct < 75) return { label: "moderate", tone: "amber" };
  return { label: "busy", tone: "coral" };
}

// Status for a Wi-Fi-sensed space, in the same shape roomStatus() returns
// for classrooms, so scoring, sorting and cards work unchanged.
export function wifiStatus(space, day, nowMin) {
  const w = openWindow(space);
  if (nowMin < w.open || nowMin >= w.close) {
    return { free: false, closed: true, busyUntil: nowMin < w.open ? w.openLabel : `${w.openLabel} tomorrow`, crowd: 0 };
  }
  const crowd = crowdAt(space, day, nowMin);
  const freeFor = w.close - nowMin;
  // A packed space counts as "not free" for matching (no seat for you).
  if (crowd >= 92) return { free: false, full: true, busyUntil: "it thins out", crowd, freeUntilMin: w.close };
  return { free: true, freeFor, freeUntilMin: w.close, crowd };
}
