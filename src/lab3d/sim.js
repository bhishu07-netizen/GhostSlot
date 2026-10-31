// Live Sensing Room: people agents, the IR door counter and the three-way
// reconciliation (IR door count vs QR check-ins vs Wi-Fi estimate).
// Plan coordinates in metres: x across the room (0..6), y into the room
// (0 = front wall with the door, 6 = back wall). Outside (corridor) is y < 0.
// Everything here is SIMULATED.

export const ROOM_W = 6, ROOM_D = 6;
export const DOOR = { x: 3, half: 0.5 };          // door opening x in [2.5, 3.5]
export const BEAM_A = -0.09;                       // outside beam (y)
export const BEAM_B = 0.09;                        // inside beam (y)
export const BODY_R = 0.19;                        // body half-depth that cuts a beam
export const SCANNER = { x: 4.05, y: 0.12, stand: { x: 4.05, y: 0.62 } }; // door QR on the front wall, inside
export const OUTSIDE_SPAWN = { x: 3, y: -2.2 };
const SPEED = 1.15; // m/s walking

// 10 seats: two rows of desks.
export const SEATS = [];
for (const row of [2.6, 4.3]) for (const x of [0.9, 2.0, 3.0, 4.0, 5.1]) SEATS.push({ x, y: row + 0.45 });

const NAMES = ["Aarav", "Diya", "Kabir", "Meher", "Ishaan", "Riya", "Vihaan", "Anaya", "Arjun", "Sara", "Neel", "Tara"];
const SHIRTS = [0x8b5cf6, 0x3ddc97, 0xf5b544, 0x5b9bea, 0xff6b6b, 0xe879f9, 0x22d3ee, 0xa3e635, 0xfb923c, 0xf472b6, 0x94a3b8, 0x60a5fa];

let NEXT = 1;
export function resetIds() { NEXT = 1; }

export function makeAgent({ scans = true, seat = null, delay = 0, tailgateOf = null } = {}) {
  const id = NEXT++;
  return {
    id, name: NAMES[(id - 1) % NAMES.length], shirt: SHIRTS[(id - 1) % SHIRTS.length],
    scans, seat, x: OUTSIDE_SPAWN.x + (tailgateOf ? 0.02 : 0), y: OUTSIDE_SPAWN.y, heading: Math.PI / 2,
    state: "waiting", wait: delay, path: [], checkedIn: false, scanT: 0, walk: 0, seated: false,
    fidgetX: 0, fidgetY: 0, phase: Math.random() * 6.28, turnBack: false,
  };
}

// Plan a route (list of waypoints) for an agent's next phase.
function route(a, phase) {
  if (phase === "enter") {
    const p = [{ x: DOOR.x, y: -0.6 }, { x: DOOR.x, y: 0.75 }];
    if (a.turnBack) return [{ x: DOOR.x, y: -0.6 }, { x: DOOR.x, y: 0.22 }];
    return p;
  }
  if (phase === "scan") return [SCANNER.stand];
  if (phase === "seat") {
    const s = a.seat || { x: 1 + Math.random() * 4, y: 2.2 + Math.random() * 3 };
    // walk around the desks along the aisle in front of them
    return [{ x: s.x, y: Math.min(s.y - 0.55, 2.0) }, { x: s.x, y: s.y }];
  }
  if (phase === "leave") {
    return [{ x: a.x, y: Math.min(a.y - 0.6, 2.0) }, { x: DOOR.x, y: 0.75 }, { x: DOOR.x, y: -0.6 }, { x: OUTSIDE_SPAWN.x, y: OUTSIDE_SPAWN.y }];
  }
  if (phase === "back") return [{ x: DOOR.x, y: -0.6 }, { x: OUTSIDE_SPAWN.x, y: OUTSIDE_SPAWN.y }];
  return [];
}

export function startLeaving(a) {
  if (a.state === "gone" || a.state === "leaving" || a.state === "waiting") return;
  a.seated = false;
  a.state = "leaving";
  a.path = route(a, "leave");
}

// Advance one agent by dt. Calls hooks.onCheckIn / onCheckOut.
export function stepAgent(a, dt, hooks) {
  if (a.state === "gone") return;
  if (a.state === "waiting") {
    a.wait -= dt;
    if (a.wait <= 0) { a.state = "entering"; a.path = route(a, "enter"); }
    return;
  }
  if (a.state === "scanning") {
    a.scanT -= dt;
    if (a.scanT <= 0) {
      a.checkedIn = true; hooks.onCheckIn?.(a);
      a.state = "toSeat"; a.path = route(a, "seat");
    }
    a.walk = 0;
    return;
  }
  if (a.state === "seated" || a.state === "idle") {
    // small natural movement while sitting
    a.fidgetX = 0.9 * a.fidgetX + 0.01 * gauss();
    a.fidgetY = 0.9 * a.fidgetY + 0.01 * gauss();
    a.walk = 0;
    return;
  }
  const wp = a.path[0];
  if (!wp) {
    // reached the end of the route
    if (a.state === "entering") {
      if (a.turnBack) { a.state = "turningBack"; a.path = route(a, "back"); return; }
      if (a.scans) { a.state = "toScanner"; a.path = route(a, "scan"); }
      else { a.state = "toSeat"; a.path = route(a, "seat"); }
    } else if (a.state === "toScanner") { a.state = "scanning"; a.scanT = 1.4; a.heading = -Math.PI / 2; }
    else if (a.state === "toSeat") { a.state = a.seat ? "seated" : "idle"; a.seated = !!a.seat; a.heading = -Math.PI / 2; }
    else if (a.state === "leaving" || a.state === "turningBack") {
      if (a.checkedIn) { a.checkedIn = false; hooks.onCheckOut?.(a); }
      a.state = "gone";
    }
    return;
  }
  const dx = wp.x - a.x, dy = wp.y - a.y, d = Math.hypot(dx, dy);
  const step = SPEED * dt;
  if (d <= step) { a.x = wp.x; a.y = wp.y; a.path.shift(); }
  else { a.x += (dx / d) * step; a.y += (dy / d) * step; a.heading = Math.atan2(dy, dx); }
  a.walk += dt * 7.5;
}

export function moveAgentTo(a, x, y) {
  if (a.state === "gone" || a.state === "waiting") return;
  x = Math.max(0.35, Math.min(ROOM_W - 0.35, x)); y = Math.max(0.5, Math.min(ROOM_D - 0.35, y));
  a.seated = false; a.seat = null;
  a.state = "toSeat";
  a.path = [{ x, y }];
}

export const isInside = (a) => a.state !== "gone" && a.state !== "waiting" && a.y > 0.02;
export const radioPos = (a) => ({ x: a.x + a.fidgetX, y: a.y + a.fidgetY });

// ---- IR door counter -------------------------------------------------------
// Two beams across the door: A (outside) and B (inside). Each frame we read
// which beams are cut: 0 none, 1 = A, 2 = B, 3 = both. While someone is in the
// doorway the sequence of states is collected; when both beams clear:
//   A -> A+B -> B -> clear  = ENTRY (+1)
//   B -> A+B -> A -> clear  = EXIT  (-1)
//   anything else (half step in and back, a hand waved) = ignored
// A beam blocked for more than 4 s (someone standing in the door) resets.
export function makeDoorCounter() {
  return { last: 0, seq: [], since: 0, entries: 0, exits: 0, events: [], beams: { a: false, b: false } };
}
export function beamsCut(agents) {
  let a = false, b = false;
  for (const p of agents) {
    if (p.state === "gone" || p.state === "waiting") continue;
    if (Math.abs(p.x - DOOR.x) > DOOR.half + 0.05) continue;
    if (Math.abs(p.y - BEAM_A) < BODY_R) a = true;
    if (Math.abs(p.y - BEAM_B) < BODY_R) b = true;
  }
  return { a, b };
}
export function stepDoorCounter(c, agents, t) {
  const { a, b } = beamsCut(agents);
  c.beams = { a, b };
  const code = (a ? 1 : 0) | (b ? 2 : 0);
  if (code !== c.last) {
    if (code === 0) {
      const s = c.seq;
      const name = s.map((x) => ["", "A", "B", "A+B"][x]).join(" → ");
      if (s.length >= 3 && s[0] === 1 && s[s.length - 1] === 2 && s.includes(3)) {
        c.entries++; push(c, t, `${name} → clear  ⇒  ENTRY (+1)`, "in");
      } else if (s.length >= 3 && s[0] === 2 && s[s.length - 1] === 1 && s.includes(3)) {
        c.exits++; push(c, t, `${name} → clear  ⇒  EXIT (−1)`, "out");
      } else if (s.length) {
        push(c, t, `${name} → clear  ⇒  ignored (didn't cross fully)`, "skip");
      }
      c.seq = [];
    } else if (c.seq[c.seq.length - 1] !== code) {
      c.seq.push(code);
    }
    c.last = code; c.since = t;
  } else if (code !== 0 && t - c.since > 4) {
    push(c, t, "beam blocked > 4 s (someone standing in the door)  ⇒  reset, no count", "skip");
    c.seq = []; c.since = t;
  }
}
function push(c, t, text, kind) {
  c.events.push({ t, text, kind });
  if (c.events.length > 40) c.events.shift();
}
export const doorInside = (c) => Math.max(0, c.entries - c.exits);

// ---- reconciliation ----------------------------------------------------------
export function verdict({ ir, qr, wifi, wifiOn }) {
  const out = [];
  if (ir > qr) out.push({ tone: "warn", text: `${ir - qr} ${ir - qr === 1 ? "person is" : "people are"} inside without checking in` });
  if (ir === qr && ir > 0) out.push({ tone: "good", text: "Everyone inside has checked in" });
  if (qr > ir) out.push({ tone: "warn", text: `${qr - ir} check-in${qr - ir === 1 ? "" : "s"} without a matching entry at the door (scanned from outside?)` });
  if (wifiOn && wifi != null) {
    const w = Math.round(wifi);
    if (ir === 0 && w === 0) out.push({ tone: "good", text: "Room empty: door count and Wi-Fi agree" });
    // Wi-Fi's error grows with the crowd, so a gap of 1 matters only in a small group.
    else if (w > ir && (w - ir >= 2 || ir <= 3)) out.push({ tone: "bad", text: `Wi-Fi sees ≈${w}, door counted ${ir}: someone got past the door counter (tailgating?)` });
    else if (Math.abs(w - ir) <= 1) out.push({ tone: "good", text: `Wi-Fi confirms the door count (≈${w} vs ${ir})` });
    else out.push({ tone: "bad", text: `Door counted ${ir}, Wi-Fi sees only ≈${w}: possible miscount or people very still` });
    if (qr > 0 && w === 0) out.push({ tone: "bad", text: "Checked in but the room looks empty: ghost booking, room will be released" });
  } else if (!wifiOn) {
    out.push({ tone: "muted", text: "Wi-Fi boards off: no independent check of the door count" });
  }
  // If Wi-Fi caught someone the door missed, "everyone checked in" is no longer known to be true.
  if (out.some((v) => v.text.includes("tailgating"))) return out.filter((v) => !v.text.startsWith("Everyone inside"));
  return out;
}

function gauss() { const u = Math.max(Math.random(), 1e-12), v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
