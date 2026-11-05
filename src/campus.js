// ─────────────────────────────────────────────────────────────────────────────
// Campus map layout for GhostSlot. The rooms themselves live in App.jsx and
// their free/busy status comes only from the timetable (plus bookings).
// Map positions are DEMO VALUES. Correct them here, in one place.
// ─────────────────────────────────────────────────────────────────────────────

// Where the classroom rooms from App.jsx sit on the map.
export const ROOM_POSITIONS = {
  "A2-104": { x: 196, y: 300 },
  "A1-212": { x: 196, y: 420 },
  "CSE-Lab-9": { x: 380, y: 186 },
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

// ── Scale + GPS calibration ─────────────────────────────────────────────────
// Metres per map unit. DEMO VALUE: the schematic spans roughly 1.3 km across
// its 1000 units. Fix this once the map is drawn to scale.
export const MAP_METERS_PER_UNIT = 1.3;

// GPS anchors: a real coordinate matched to its spot on this map. With three
// or more (spread out, not in a line), the phone's GPS lands the "You" dot on
// the map. To add one: stand at the spot, or long-press it in Google Maps and
// copy the "30.7xxx, 76.5xxx" pair, then add { label, lat, lng, x, y } with x/y
// from MAP_ZONES / ROOM_POSITIONS. // Left empty on purpose: no coordinate here is guessed.
export const GEO_ANCHORS = [];

// Optional: drop the official CU campus map at public/brand/campus-map.png and
// set this to "/brand/campus-map.png". It draws under the pins; then adjust
// the x/y values above so the pins sit on the right buildings.
export const CAMPUS_MAP_IMAGE = null;
