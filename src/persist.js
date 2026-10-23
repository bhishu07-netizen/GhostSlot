// Per-user, per-browser memory: your timetable edits, an active booking and
// karma survive a reload or closing the tab. Stored in localStorage under the
// user's id, never sent anywhere. Anything unreadable is ignored, so a broken
// or old entry can't crash the app.
const VERSION = 2;
const key = (userId) => `gs.state.v${VERSION}.${userId}`;

export function loadState(userId) {
  if (!userId) return null;
  try {
    const s = JSON.parse(localStorage.getItem(key(userId)) || "null");
    return s && typeof s === "object" ? s : null;
  } catch { return null; }
}

// Erasure: wipe this user's on-device copy (used when the account is deleted).
export function clearState(userId) {
  if (!userId) return;
  try {
    for (let v = 1; v <= VERSION; v++) localStorage.removeItem(`gs.state.v${v}.${userId}`);
  } catch { /* storage blocked */ }
}

export function saveState(userId, state) {
  if (!userId) return;
  try { localStorage.setItem(key(userId), JSON.stringify(state)); } catch { /* storage full or private mode */ }
}

const isSlot = (x) => x && typeof x.id === "string" && typeof x.day === "string" && /^\d\d:\d\d$/.test(x.start) && /^\d\d:\d\d$/.test(x.end);
export function cleanSlots(list) { return Array.isArray(list) ? list.filter(isSlot).slice(0, 400) : null; }
export function cleanRoomSlots(obj) {
  if (!obj || typeof obj !== "object") return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) { const c = cleanSlots(v); if (c) out[k] = c; }
  return out;
}
