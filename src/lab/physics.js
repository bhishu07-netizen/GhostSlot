// GhostSlot Sensing Lab: a physics-based simulation of the 4-board ESP32-S3
// Wi-Fi CSI mesh. Everything here is SIMULATED and labelled as such in the UI.
//
// Radio model (2-D, one floor plane):
//   - 2.4 GHz, channel 6 (2.437 GHz), 52 used OFDM subcarriers, 312.5 kHz apart
//   - multipath per link: direct path + 4 first-order wall reflections
//     + one scattered path per person (bistatic, amplitude ~ 1/(d1*d2))
//   - a body inside the first Fresnel zone of the direct path attenuates it
//   - receiver noise (complex Gaussian) and per-packet AGC gain jitter
// Processing: the same steps as firmware v2 (hardware/gs_mesh_node):
//   per-packet gain normalisation -> per-subcarrier std over a 2 s window
//   -> mean over subcarriers x 1000 = "motion"; RSSI from total power;
//   8 subcarrier-group "profile" values x 100.

export const C0 = 299_792_458;
export const F0 = 2.437e9;
export const DF = 312.5e3;
export const LAMBDA = C0 / F0; // ~12.3 cm
export const SUBCARRIERS = [];
for (let k = -26; k <= 26; k++) if (k !== 0) SUBCARRIERS.push(k);
const KF = SUBCARRIERS.map((k) => (2 * Math.PI * (F0 + k * DF)) / C0);
const NSC = SUBCARRIERS.length;
export const GROUPS = 8;

export const ROOM = { w: 6, h: 6 }; // metres
const INSET = 0.25;
// Same numbering as the real room: front = 1 & 2, back = 3 & 4, left = 1 & 3, right = 2 & 4.
export const NODES = [
  { id: 1, x: INSET, y: INSET },
  { id: 2, x: ROOM.w - INSET, y: INSET },
  { id: 3, x: INSET, y: ROOM.h - INSET },
  { id: 4, x: ROOM.w - INSET, y: ROOM.h - INSET },
];
export const PAIRS = [[1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]];
export const PAIR_NAMES = PAIRS.map(([a, b]) => `${a}↔${b}`);
// 12 directed links: every board hears the other three (tx -> rx). Each
// direction has its own receiver noise and AGC, like the real ESP-NOW mesh.
export const LINKS = PAIRS.flatMap(([a, b]) => [[a, b], [b, a]]);
export const LINK_NAMES = LINKS.map(([a, b]) => `${a}→${b}`);
const PAIR_OF_LINK = LINKS.map(([a, b]) => PAIRS.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a)));

export const WINDOW_S = 2;          // one feature row every 2 s, like the boards
export const PACKETS_PER_WINDOW = 25; // packets per link per window in the sim

const WALL_GAMMA = 0.45;  // wall reflection amplitude
const BODY_SIGMA = 1.1;   // body scattering strength (tuned so readings land in the range our real boards report)
const BODY_BLOCK = 0.55;  // max loss of the direct path when a body sits on it

// ---- random numbers (seedable so training sessions are reproducible) ----
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const gauss = () => { const u = Math.max(next(), 1e-12), v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return { next, gauss };
}

const node = (id) => NODES[id - 1];
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// Distance from point P to segment AB and where along it (0..1) the foot lies.
function toSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const L2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2));
  return { d: Math.hypot(px - (ax + t * vx), py - (ay + t * vy)), t };
}

// Static paths for a link (no people): direct + 4 wall images.
const staticCache = new Map();
function staticPaths(a, b) {
  const key = `${a}-${b}`;
  if (staticCache.has(key)) return staticCache.get(key);
  const A = node(a), B = node(b);
  const paths = [{ len: dist(A.x, A.y, B.x, B.y), amp: 0, los: true }];
  paths[0].amp = 1 / paths[0].len;
  const images = [[-A.x, A.y], [2 * ROOM.w - A.x, A.y], [A.x, -A.y], [A.x, 2 * ROOM.h - A.y]];
  for (const [ix, iy] of images) {
    const len = dist(ix, iy, B.x, B.y);
    paths.push({ len, amp: WALL_GAMMA / len, los: false });
  }
  staticCache.set(key, paths);
  return paths;
}

// Complex channel H(f) for every subcarrier, as [re[], im[]].
export function channel(a, b, people, env, R) {
  const A = node(a), B = node(b);
  const sp = staticPaths(a, b);
  const losLen = sp[0].len;
  // Direct path loss from bodies in the first Fresnel zone.
  let losGain = 1;
  for (const p of people) {
    const { d, t } = toSegment(p.x, p.y, A.x, A.y, B.x, B.y);
    if (t <= 0 || t >= 1) continue;
    const d1 = losLen * t, d2 = losLen * (1 - t);
    const r = Math.sqrt((LAMBDA * d1 * d2) / losLen); // first Fresnel radius
    const reach = 1.6 * r + 0.18;                      // + body half-width
    if (d < reach) losGain *= 1 - BODY_BLOCK * (1 - d / reach);
  }
  const re = new Float64Array(NSC), im = new Float64Array(NSC);
  const add = (len, amp) => {
    for (let k = 0; k < NSC; k++) { const ph = -KF[k] * len; re[k] += amp * Math.cos(ph); im[k] += amp * Math.sin(ph); }
  };
  add(sp[0].len, sp[0].amp * losGain);
  for (let i = 1; i < sp.length; i++) add(sp[i].len, sp[i].amp);
  for (const p of people) {
    const d1 = Math.max(0.15, dist(A.x, A.y, p.x, p.y)), d2 = Math.max(0.15, dist(p.x, p.y, B.x, B.y));
    add(d1 + d2, BODY_SIGMA / (d1 * d2));
  }
  // Receiver noise relative to the direct path, plus AGC gain jitter.
  const sigma = (env.noise ?? 0.13) / losLen;
  const g = 1 + (env.agc ?? 0.08) * R.gauss();
  for (let k = 0; k < NSC; k++) {
    re[k] = g * (re[k] + sigma * R.gauss());
    im[k] = g * (im[k] + sigma * R.gauss());
  }
  return { re, im };
}

// ---- firmware-equivalent processing over one window ----
export function newWindow() {
  return LINKS.map(() => ({ n: 0, sum: new Float64Array(NSC), sq: new Float64Array(NSC), pow: 0, prof: new Float64Array(GROUPS) }));
}

// Add one packet per directed link to the window; returns the raw amplitudes per link (for plotting).
export function samplePacket(win, people, env, R, nodesOn = [true, true, true, true]) {
  const amps = [];
  LINKS.forEach(([a, b], i) => {
    if (!nodesOn[a - 1] || !nodesOn[b - 1]) { amps.push(null); return; }
    const { re, im } = channel(a, b, people, env, R);
    const amp = new Float64Array(NSC);
    let total = 0, pw = 0;
    for (let k = 0; k < NSC; k++) { amp[k] = Math.hypot(re[k], im[k]); total += amp[k]; pw += amp[k] * amp[k]; }
    const inv = total > 0 ? NSC / total : 0; // gain normalisation (firmware v2)
    const w = win[i];
    w.n++;
    w.pow += pw / NSC;
    for (let k = 0; k < NSC; k++) {
      const v = amp[k] * inv;
      w.sum[k] += v; w.sq[k] += v * v;
      w.prof[Math.min(GROUPS - 1, Math.floor((k * GROUPS) / NSC))] += v;
    }
    amps.push(amp);
  });
  return amps;
}

// What one directed link reports after a window (like each board's report).
export function linkReport(w) {
  if (w.n < 3) return null;
  let s = 0, used = 0;
  for (let k = 2; k < NSC; k++) {
    const m = w.sum[k] / w.n;
    const v = Math.max(0, w.sq[k] / w.n - m * m);
    s += Math.sqrt(v); used++;
  }
  const per = NSC / GROUPS;
  return {
    motion: (s / used) * 1000,
    // RSSI from total received power; tx power chosen so readings sit near the real boards'.
    rssi: 10 * Math.log10(w.pow / w.n + 1e-12) - 40,
    prof: Array.from(w.prof, (x) => (x / w.n / per) * 100),
  };
}

// Turn a finished window into the same 64-value feature row the real server
// builds: the two directions of each pair are averaged.
export function windowFeatures(win) {
  const reps = win.map(linkReport);
  const motions = [];
  const row = [];
  PAIRS.forEach((_, pi) => {
    const got = reps.filter((r, li) => r && PAIR_OF_LINK[li] === pi);
    if (!got.length) { row.push(-1, -1, ...new Array(GROUPS).fill(-1)); return; }
    const avg = (f) => got.reduce((a, r) => a + f(r), 0) / got.length;
    const motion = avg((r) => r.motion);
    motions.push(motion);
    row.push(round(motion, 3), round(avg((r) => r.rssi), 2), ...Array.from({ length: GROUPS }, (_, g) => round(avg((r) => r.prof[g]), 2)));
  });
  const n = motions.length;
  const mean = n ? motions.reduce((a, b) => a + b, 0) / n : -1;
  const max = n ? Math.max(...motions) : -1;
  const std = n > 1 ? Math.sqrt(motions.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : n === 1 ? 0 : -1;
  row.push(round(mean, 3), round(max, 3), round(std, 3), n);
  return row;
}
const round = (x, d) => { const p = 10 ** d; return Math.round(x * p) / p; };

// ---- people ----
// activity: "still" (sitting, breathing), "fidget" (small natural movement), "walk" (moves to a target)
export function makePerson(id, x, y, activity = "fidget") {
  return { id, x, y, bx: x, by: y, activity, tx: x, ty: y, phase: Math.random() * 6.28, jx: 0, jy: 0 };
}
const clampX = (v) => Math.max(0.35, Math.min(ROOM.w - 0.35, v));
const clampY = (v) => Math.max(0.35, Math.min(ROOM.h - 0.35, v));

// Advance one person by dt seconds. Returns the position the radio "sees".
export function stepPerson(p, dt, t, R) {
  if (p.activity === "walk") {
    const dx = p.tx - p.bx, dy = p.ty - p.by, d = Math.hypot(dx, dy);
    const v = 0.9; // m/s
    if (d < 0.1) { p.tx = clampX(0.5 + R.next() * (ROOM.w - 1)); p.ty = clampY(0.5 + R.next() * (ROOM.h - 1)); }
    else { const s = Math.min(d, v * dt); p.bx += (dx / d) * s; p.by += (dy / d) * s; }
  } else if (p.target) {
    // Commanded move (click / arrow keys) for still or fidgeting people.
    const dx = p.target.x - p.bx, dy = p.target.y - p.by, d = Math.hypot(dx, dy);
    if (d < 0.05) p.target = null; else { const s = Math.min(d, 1.1 * dt); p.bx += (dx / d) * s; p.by += (dy / d) * s; }
  }
  // Small body motion: breathing for everyone, extra sway when fidgeting.
  const breath = 0.004 * Math.sin(2 * Math.PI * 0.25 * t + p.phase);
  if (p.activity === "fidget") {
    p.jx = 0.9 * p.jx + 0.012 * R.gauss();
    p.jy = 0.9 * p.jy + 0.012 * R.gauss();
  } else { p.jx *= 0.8; p.jy *= 0.8; }
  p.x = clampX(p.bx + p.jx + breath);
  p.y = clampY(p.by + p.jy);
  return p;
}

// Random placements for training data.
export function randomPeople(n, R, mix = { still: 0.25, fidget: 0.55, walk: 0.2 }) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = R.next();
    const activity = r < mix.still ? "still" : r < mix.still + mix.fidget ? "fidget" : "walk";
    const p = makePerson(i + 1, clampX(0.5 + R.next() * (ROOM.w - 1)), clampY(0.5 + R.next() * (ROOM.h - 1)), activity);
    p.phase = R.next() * 6.28;
    out.push(p);
  }
  return out;
}

// Simulate one full 2 s window for a scene and return its feature row.
export function simulateWindow(people, env, R, t0 = 0, nodesOn) {
  const win = newWindow();
  const dt = WINDOW_S / PACKETS_PER_WINDOW;
  for (let i = 0; i < PACKETS_PER_WINDOW; i++) {
    const t = t0 + i * dt;
    for (const p of people) stepPerson(p, dt, t, R);
    samplePacket(win, people, env, R, nodesOn);
  }
  return windowFeatures(win);
}

// ---- detector: ridge regression on motion + changes from the empty-room baseline ----
// Uses only what the real system has: per-link motion, RSSI and profile shifts.
export function detectorInputs(row, baseline) {
  const x = [];
  for (let i = 0; i < PAIRS.length; i++) {
    const o = i * (2 + GROUPS);
    const m = row[o], r = row[o + 1];
    if (m < 0) { x.push(0, 0, 0); continue; }
    const b = baseline?.[i];
    const dr = b ? r - b.rssi : 0;
    let dp = 0;
    if (b) for (let g = 0; g < GROUPS; g++) dp += Math.abs(row[o + 2 + g] - b.prof[g]);
    x.push(Math.log1p(m), dr, dp / GROUPS);
  }
  const L = row.length;
  x.push(Math.log1p(Math.max(0, row[L - 4])), Math.log1p(Math.max(0, row[L - 3])));
  return x;
}

export function baselineFrom(rows) {
  return PAIRS.map((_, i) => {
    const o = i * (2 + GROUPS);
    const ok = rows.filter((r) => r[o] >= 0);
    if (!ok.length) return null;
    const avg = (j) => ok.reduce((a, r) => a + r[j], 0) / ok.length;
    return { rssi: avg(o + 1), prof: Array.from({ length: GROUPS }, (_, g) => avg(o + 2 + g)) };
  });
}

export function fitRidge(X, y, lambda = 1) {
  const n = X.length, d = X[0].length;
  const mu = new Array(d).fill(0), sd = new Array(d).fill(0);
  for (const r of X) r.forEach((v, j) => { mu[j] += v / n; });
  for (const r of X) r.forEach((v, j) => { sd[j] += (v - mu[j]) ** 2 / n; });
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const Z = X.map((r) => [1, ...r.map((v, j) => (v - mu[j]) / sd[j])]);
  const D = d + 1;
  const A = Array.from({ length: D }, () => new Array(D).fill(0));
  const bvec = new Array(D).fill(0);
  Z.forEach((z, i) => { for (let a = 0; a < D; a++) { bvec[a] += z[a] * y[i]; for (let c = 0; c < D; c++) A[a][c] += z[a] * z[c]; } });
  for (let a = 1; a < D; a++) A[a][a] += lambda;
  // Gaussian elimination
  for (let col = 0; col < D; col++) {
    let piv = col;
    for (let r = col + 1; r < D; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]]; [bvec[col], bvec[piv]] = [bvec[piv], bvec[col]];
    const p = A[col][col] || 1e-9;
    for (let r = 0; r < D; r++) {
      if (r === col) continue;
      const f = A[r][col] / p;
      if (!f) continue;
      for (let c = col; c < D; c++) A[r][c] -= f * A[col][c];
      bvec[r] -= f * bvec[col];
    }
  }
  const w = bvec.map((v, i) => v / (A[i][i] || 1e-9));
  return { w, mu, sd };
}
export function predictRidge(m, x) {
  let s = m.w[0];
  for (let j = 0; j < x.length; j++) s += m.w[j + 1] * ((x[j] - m.mu[j]) / m.sd[j]);
  return s;
}
