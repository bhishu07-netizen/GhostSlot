// ─────────────────────────────────────────────────────────────────────────────
// "Where am I on campus?" for GhostSlot.
//
// A position is a point on the campus map (same 1000 × 640 coordinates as the
// pins). It can come from three places, most precise first:
//   qr   : the user scanned the QR sticker on a room door (?at=<space id>)
//   pick : the user picked their block / place, or tapped the map
//   gps  : the phone's GPS, mapped onto the campus map through anchor points
//          (GEO_ANCHORS in campus.js, or ones calibrated on this device)
//
// Walking times are ESTIMATES from straight-line map distance × a route
// factor. MAP_METERS_PER_UNIT in campus.js sets the scale; correct it once the
// map is drawn to scale.
// ─────────────────────────────────────────────────────────────────────────────
import { MAP_ZONES, ROOM_POSITIONS, GEO_ANCHORS, MAP_METERS_PER_UNIT } from "./campus";

const WALK_M_PER_MIN = 75;   // relaxed student pace
const ROUTE_FACTOR = 1.3;    // paths aren't straight lines
const MAX_AGE_MS = 3 * 60 * 60 * 1000; // a saved position goes stale after 3 h
const STORE_KEY = "gs.location.v1";
const ANCHOR_KEY = "gs.geoAnchors.v1";

// Map extent used to decide whether a GPS fix is "on campus".
const BOUNDS = { x0: 60, y0: 60, x1: 1020, y1: 660 };

// ── Places you can say you're at ────────────────────────────────────────────
export function placeList(roomMeta) {
  const zones = MAP_ZONES.map((z) => ({ id: `zone:${slug(z.label)}`, label: z.label, group: "Blocks & areas", x: z.x + z.w / 2, y: z.y + z.h / 2 }));
  const spaces = roomMeta
    .filter((r) => r.pos)
    .map((r) => ({ id: r.id, label: r.name, group: groupOf(r.category), x: r.pos.x, y: r.pos.y }));
  return [...zones, ...spaces];
}
const groupOf = (c) => ({ study: "Study rooms", food: "Food", sports: "Sports", hangout: "Hangout" }[c] || "Other");
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export function findPlace(places, id) {
  if (!id) return null;
  const k = String(id).trim().toLowerCase();
  return places.find((p) => p.id.toLowerCase() === k || p.id.toLowerCase() === `zone:${k}` || slug(p.label) === k) || null;
}

// The nearest named place to a map point, for a friendly "near X" label.
export function nearestPlace(places, x, y) {
  let best = null, bestD = Infinity;
  for (const p of places) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

// ── Walking estimate ─────────────────────────────────────────────────────────
export function walkMinutes(from, to) {
  if (!from || !to) return null;
  const meters = Math.hypot(to.x - from.x, to.y - from.y) * MAP_METERS_PER_UNIT * ROUTE_FACTOR;
  return Math.max(1, Math.round(meters / WALK_M_PER_MIN));
}
export function walkLabel(min) {
  return min <= 1 ? "1 min walk" : `${min} min walk`;
}

// ── Persisted position (this browser only, per user) ────────────────────────
export function loadLocation(userId) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    const loc = all[userId];
    if (!loc || typeof loc.x !== "number" || typeof loc.y !== "number") return null;
    if (Date.now() - (loc.at || 0) > MAX_AGE_MS) return null;
    return loc;
  } catch { return null; }
}
export function saveLocation(userId, loc) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    if (loc) all[userId] = loc; else delete all[userId];
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch { /* private mode: keep it in memory only */ }
}

// ── GPS → campus map ─────────────────────────────────────────────────────────
// Anchors are { label, lat, lng, x, y }: a real GPS fix matched to its spot
// on the map. Three or more spread-out anchors give an affine fit, which is
// enough for a campus-sized area.
export function loadAnchors() {
  let local = [];
  try { local = JSON.parse(localStorage.getItem(ANCHOR_KEY) || "[]"); } catch { local = []; }
  const valid = (a) => a && Number.isFinite(a.lat) && Number.isFinite(a.lng) && Number.isFinite(a.x) && Number.isFinite(a.y);
  const byLabel = new Map();
  for (const a of [...(GEO_ANCHORS || []), ...local]) if (valid(a)) byLabel.set(a.label, a);
  return [...byLabel.values()];
}
export function saveAnchor(anchor) {
  let local = [];
  try { local = JSON.parse(localStorage.getItem(ANCHOR_KEY) || "[]"); } catch { local = []; }
  local = local.filter((a) => a.label !== anchor.label);
  local.push(anchor);
  try { localStorage.setItem(ANCHOR_KEY, JSON.stringify(local)); } catch { /* ignore */ }
  return loadAnchors();
}
export function clearLocalAnchors() {
  try { localStorage.removeItem(ANCHOR_KEY); } catch { /* ignore */ }
}

// Least-squares affine fit: [x y] = [lng lat 1] · M. Returns null when the
// anchors can't define a plane (fewer than 3, or all in a line).
export function fitGeo(anchors) {
  if (!anchors || anchors.length < 3) return null;
  const lng0 = avg(anchors.map((a) => a.lng)), lat0 = avg(anchors.map((a) => a.lat));
  const rows = anchors.map((a) => [(a.lng - lng0) * 1e4, (a.lat - lat0) * 1e4, 1]);
  const AtA = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const Atx = [0, 0, 0], Aty = [0, 0, 0];
  rows.forEach((r, i) => {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) AtA[j][k] += r[j] * r[k];
      Atx[j] += r[j] * anchors[i].x;
      Aty[j] += r[j] * anchors[i].y;
    }
  });
  const cx = solve3(AtA, Atx), cy = solve3(AtA, Aty);
  if (!cx || !cy) return null;
  const toMap = (lat, lng) => {
    const u = (lng - lng0) * 1e4, v = (lat - lat0) * 1e4;
    return { x: cx[0] * u + cx[1] * v + cx[2], y: cy[0] * u + cy[1] * v + cy[2] };
  };
  // Inverse, for "open in Google Maps" walking directions.
  const det = cx[0] * cy[1] - cx[1] * cy[0];
  const toGeo = Math.abs(det) < 1e-12 ? null : (x, y) => {
    const X = x - cx[2], Y = y - cy[2];
    const u = (cy[1] * X - cx[1] * Y) / det, v = (-cy[0] * X + cx[0] * Y) / det;
    return { lat: lat0 + v / 1e4, lng: lng0 + u / 1e4 };
  };
  return { toMap, toGeo };
}
const avg = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
function solve3(m, b) {
  const a = m.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-9) return null;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k];
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}

export function onCampus(pt) {
  return pt && pt.x >= BOUNDS.x0 - 150 && pt.x <= BOUNDS.x1 + 150 && pt.y >= BOUNDS.y0 - 150 && pt.y <= BOUNDS.y1 + 150;
}

// One GPS reading as a promise, with errors a person can act on.
export function readGps({ timeoutMs = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(gpsError("unsupported", "This browser can't share your location. Pick your block instead."));
      return;
    }
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      reject(gpsError("insecure", "Location only works over HTTPS. Pick your block instead."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: Math.round(pos.coords.accuracy || 0) }),
      (err) => {
        if (err.code === 1) reject(gpsError("denied", "Location is blocked for GhostSlot. Allow it in your browser settings, or pick your block."));
        else if (err.code === 3) reject(gpsError("timeout", "GPS took too long (common indoors). Pick your block, or try again near a window."));
        else reject(gpsError("unavailable", "Couldn't get a GPS fix right now. Pick your block instead."));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 }
    );
  });
}
function gpsError(code, message) { const e = new Error(message); e.code = code; return e; }

export function directionsUrl(geo) {
  if (!geo) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${geo.lat.toFixed(6)},${geo.lng.toFixed(6)}&travelmode=walking`;
}

// Link that opens GhostSlot with your spot set to a room (/?at=<room id>).
export function doorLink(origin, id) {
  return `${origin.replace(/\/+$/, "")}/?at=${encodeURIComponent(id)}`;
}

// Re-exported so callers don't need two imports.
export { ROOM_POSITIONS };
