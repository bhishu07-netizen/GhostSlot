// GhostSlot Sensing Lab (/lab): a virtual room with 4 ESP32-S3 nodes and 12
// directed Wi-Fi links. You command the people; the readings come from the
// physics model in physics.js, processed the same way as firmware v2.
// Everything on this page is SIMULATED and says so.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as P from "./physics";

const C = { bg: "#07060C", card: "#120F1E", border: "rgba(196,181,253,0.10)", text: "#F4F1FF", sub: "#A39CC4", muted: "#857DA8",
  silver: "#C4B5FD", violet: "#8B5CF6", good: "#3DDC97", warn: "#F5B544", bad: "#FF6B6B", blue: "#5B9BEA" };
const head = "'Space Grotesk', sans-serif", mono = "'JetBrains Mono', monospace";
const SCALE = 100; // px per metre in the SVG
const PAD = 30;
const VIEW = P.ROOM.w * SCALE + PAD * 2;
const MAX_PEOPLE = 10;
const ENVS = { quiet: { noise: 0.09, label: "Quiet Wi-Fi" }, normal: { noise: 0.13, label: "Normal" }, busy: { noise: 0.2, label: "Busy Wi-Fi" } };
const ACTS = [["still", "Still (sitting)"], ["fidget", "Natural (small moves)"], ["walk", "Walking"]];
const PACKET_DT = P.WINDOW_S / P.PACKETS_PER_WINDOW;

const btn = (on = false, tone) => ({
  background: on ? "rgba(167,139,250,0.18)" : "rgba(196,181,253,0.05)", color: on ? "#F1ECFF" : "#D2C8F5",
  border: `1px solid ${on ? "rgba(167,139,250,0.55)" : tone || "rgba(196,181,253,0.16)"}`, borderRadius: 10,
  padding: "8px 12px", fontSize: 13, cursor: "pointer", fontFamily: "inherit", minHeight: 36,
});
const primary = { ...btn(), background: "linear-gradient(180deg, #F1ECFF, #A78BFA)", color: "#0A0812", border: "none", fontWeight: 700 };
function Card({ title, sub, children, style }) {
  return (
    <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: 16, ...style }}>
      {title && <h2 style={{ fontFamily: head, fontSize: 16, margin: 0 }}>{title}</h2>}
      {sub && <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3, lineHeight: 1.45 }}>{sub}</div>}
      <div style={{ marginTop: title || sub ? 12 : 0 }}>{children}</div>
    </section>
  );
}

const freshPeople = () => [];
let nextId = 1;

export default function Lab() {
  // Simulation state lives in refs (fast loop); a snapshot is copied to React ~8x a second.
  const sim = useRef({
    t: 0, acc: 0, people: freshPeople(), win: P.newWindow(), R: P.rng(Date.now() % 1e9),
    nodesOn: [true, true, true, true], env: "normal", lastAmps: null, history: [], log: [], recent: [],
  });
  const [snap, setSnap] = useState({ people: [], reports: null, row: null, amps: null, log: [], t: 0 });
  const [selected, setSelected] = useState(null);
  const [linkSel, setLinkSel] = useState(4); // 1→4 by default
  const [running, setRunning] = useState(true);
  const [env, setEnv] = useState("normal");
  const [nodesOn, setNodesOn] = useState([true, true, true, true]);
  const [baseline, setBaseline] = useState(null);
  const [model, setModel] = useState(null);
  const [training, setTraining] = useState(null); // { step, pct } while running
  const [result, setResult] = useState(null);
  const [estimate, setEstimate] = useState(null);
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const modelRef = useRef(null); modelRef.current = model;
  const baseRef = useRef(null); baseRef.current = baseline;

  useEffect(() => { sim.current.env = env; }, [env]);
  useEffect(() => { sim.current.nodesOn = nodesOn; }, [nodesOn]);

  const log = useCallback((line) => {
    const s = sim.current;
    s.log.push(`${(s.t).toFixed(1).padStart(6)}s  ${line}`);
    if (s.log.length > 60) s.log.splice(0, s.log.length - 60);
  }, []);

  // ---- main loop ----
  useEffect(() => {
    let raf, last = performance.now(), lastSnap = 0;
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const dtReal = Math.min(0.1, (now - last) / 1000); last = now;
      const s = sim.current;
      if (running) {
        s.acc += dtReal;
        while (s.acc >= PACKET_DT) {
          s.acc -= PACKET_DT;
          s.t += PACKET_DT;
          for (const p of s.people) P.stepPerson(p, PACKET_DT, s.t, s.R);
          s.lastAmps = P.samplePacket(s.win, s.people, { noise: ENVS[s.env].noise, agc: 0.08 }, s.R, s.nodesOn);
          s.packets = (s.packets || 0) + 1;
          if (s.packets % P.PACKETS_PER_WINDOW === 0) finishWindow();
        }
      }
      if (now - lastSnap > 120) {
        lastSnap = now;
        setSnap({ people: s.people.map((p) => ({ ...p })), reports: s.reports || null, row: s.row || null, amps: s.lastAmps, log: [...s.log], t: s.t });
      }
    };
    const finishWindow = () => {
      const s = sim.current;
      s.reports = s.win.map(P.linkReport);
      s.row = P.windowFeatures(s.win);
      s.win = P.newWindow();
      // Serial-monitor lines, like the boards print.
      for (let n = 1; n <= 4; n++) {
        if (!s.nodesOn[n - 1]) continue;
        const heard = P.LINKS.map((l, i) => (l[1] === n && s.reports[i] ? i : -1)).filter((i) => i >= 0);
        const m = heard.map((i) => `${P.LINK_NAMES[i]} ${s.reports[i].motion.toFixed(0)}`).join(" · ");
        log(`[mesh-${n}] sent ${heard.length} link(s) -> server ok   ${m}`);
      }
      // Live estimate (needs a trained model).
      const m = modelRef.current, b = baseRef.current;
      if (m && b) {
        const e = P.predictRidge(m, P.detectorInputs(s.row, b));
        s.recent.push(e); if (s.recent.length > 3) s.recent.shift();
        const avg = Math.max(0, s.recent.reduce((a, x) => a + x, 0) / s.recent.length);
        setEstimate({ value: avg, rmse: m.rmse });
      }
      s.history.push(s.row);
      if (s.history.length > 30) s.history.shift();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, log]);

  // ---- people controls ----
  const addPerson = (x, y) => {
    const s = sim.current;
    if (s.people.length >= MAX_PEOPLE) return;
    const px = x ?? 0.8 + Math.random() * (P.ROOM.w - 1.6), py = y ?? 0.8 + Math.random() * (P.ROOM.h - 1.6);
    const p = P.makePerson(nextId++, px, py, "fidget");
    s.people.push(p);
    setSelected(p.id);
    log(`person #${p.id} entered the room (${s.people.length} inside)`);
  };
  const removePerson = (id) => {
    const s = sim.current;
    const i = id != null ? s.people.findIndex((p) => p.id === id) : s.people.length - 1;
    if (i < 0) return;
    const [p] = s.people.splice(i, 1);
    if (selected === p.id) setSelected(null);
    log(`person #${p.id} left the room (${s.people.length} inside)`);
  };
  const setCount = (n) => {
    const s = sim.current;
    while (s.people.length < n) addPerson();
    while (s.people.length > n) removePerson();
  };
  const setActivity = (id, act) => {
    const p = sim.current.people.find((q) => q.id === id);
    if (p) { p.activity = act; p.target = null; if (act === "walk") { p.tx = p.bx; p.ty = p.by; } }
  };
  const allActivity = (act) => sim.current.people.forEach((p) => setActivity(p.id, act));
  const formation = (kind) => {
    const ps = sim.current.people, n = ps.length;
    ps.forEach((p, i) => {
      let x, y;
      if (kind === "centre") { const a = (i / Math.max(n, 1)) * 2 * Math.PI; x = 3 + 0.5 * Math.cos(a); y = 3 + 0.5 * Math.sin(a); }
      else if (kind === "spread") { const cols = Math.ceil(Math.sqrt(n)); x = 1 + ((i % cols) + 0.5) * (4 / cols); y = 1 + (Math.floor(i / cols) + 0.5) * (4 / Math.ceil(n / cols)); }
      else if (kind === "front") { x = 0.9 + (i + 0.5) * (4.2 / Math.max(n, 1)); y = 1.1; }
      else { x = 0.9 + (i + 0.5) * (4.2 / Math.max(n, 1)); y = 0.9 + (i + 0.5) * (4.2 / Math.max(n, 1)); } // diagonal 1→4
      if (p.activity === "walk") p.activity = "fidget";
      p.target = { x, y };
    });
  };
  const moveSelected = (dx, dy) => {
    const p = sim.current.people.find((q) => q.id === selected);
    if (!p) return;
    if (p.activity === "walk") p.activity = "fidget";
    const base = p.target || { x: p.bx, y: p.by };
    p.target = { x: Math.max(0.35, Math.min(P.ROOM.w - 0.35, base.x + dx)), y: Math.max(0.35, Math.min(P.ROOM.h - 0.35, base.y + dy)) };
  };
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
      const k = e.key;
      const step = 0.3;
      if (k === "ArrowUp" || k === "w") moveSelected(0, -step);
      else if (k === "ArrowDown" || k === "s") moveSelected(0, step);
      else if (k === "ArrowLeft" || k === "a") moveSelected(-step, 0);
      else if (k === "ArrowRight" || k === "d") moveSelected(step, 0);
      else if (k === "+" || k === "=") addPerson();
      else if (k === "-") removePerson(selected);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- pointer: drag people, click floor to send the selected person there ----
  const toRoom = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    const k = VIEW / r.width;
    return { x: ((e.clientX - r.left) * k - PAD) / SCALE, y: ((e.clientY - r.top) * k - PAD) / SCALE };
  };
  const onDown = (e, id) => {
    e.stopPropagation();
    setSelected(id);
    dragRef.current = id;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    const id = dragRef.current;
    if (id == null) return;
    const p = sim.current.people.find((q) => q.id === id);
    if (!p) return;
    const { x, y } = toRoom(e);
    p.bx = Math.max(0.35, Math.min(P.ROOM.w - 0.35, x)); p.by = Math.max(0.35, Math.min(P.ROOM.h - 0.35, y));
    p.target = null; if (p.activity === "walk") p.activity = "fidget";
  };
  const onUp = () => { dragRef.current = null; };
  const onFloor = (e) => {
    if (dragRef.current != null) return;
    const { x, y } = toRoom(e);
    if (x < 0 || y < 0 || x > P.ROOM.w || y > P.ROOM.h) return;
    if (selected == null) { addPerson(x, y); return; }
    const p = sim.current.people.find((q) => q.id === selected);
    if (p) { if (p.activity === "walk") p.activity = "fidget"; p.target = { x: Math.max(0.35, Math.min(P.ROOM.w - 0.35, x)), y: Math.max(0.35, Math.min(P.ROOM.h - 0.35, y)) }; }
  };

  // ---- lab workflow: calibrate empty room, generate labelled data, train, test ----
  const calibrate = async () => {
    setTraining({ step: "Calibrating the empty room (10 s of simulated data)…", pct: 5 });
    await tick();
    const R = P.rng(4242), envv = { noise: ENVS[env].noise, agc: 0.08 };
    const rows = Array.from({ length: 5 }, (_, i) => P.simulateWindow([], envv, R, i * 2, nodesOn));
    const b = P.baselineFrom(rows);
    setBaseline(b);
    log("[lab] empty-room baseline saved (5 windows)");
    setTraining(null);
    return b;
  };
  const train = async () => {
    const b = baseline || (await calibrate());
    const envv = { noise: ENVS[env].noise, agc: 0.08 };
    const per = 16;
    const gen = async (seed, label, pct0) => {
      const R = P.rng(seed), X = [], y = [];
      for (let n = 0; n <= MAX_PEOPLE; n++) {
        for (let w = 0; w < per; w++) {
          const row = P.simulateWindow(P.randomPeople(n, R), envv, R, w * 2, nodesOn);
          X.push(P.detectorInputs(row, b)); y.push(n);
        }
        setTraining({ step: `${label}: ${n} ${n === 1 ? "person" : "people"} (${per} windows)`, pct: pct0 + (n / MAX_PEOPLE) * 40 });
        await tick();
      }
      return { X, y };
    };
    const A = await gen(1000 + Math.floor(Math.random() * 1e6), "Session A (training)", 5);
    const B = await gen(2000 + Math.floor(Math.random() * 1e6), "Session B (held-out test)", 50);
    setTraining({ step: "Training the model…", pct: 95 });
    await tick();
    const m = P.fitRidge(A.X, A.y, 2);
    // Honest test: session B was never used for training. Smooth over 3 windows like the live view.
    const raw = B.X.map((x) => P.predictRidge(m, x));
    const sm = raw.map((_, i) => { const g = []; for (let j = Math.max(0, i - 2); j <= i; j++) if (B.y[j] === B.y[i]) g.push(raw[j]); return Math.max(0, g.reduce((a, x) => a + x, 0) / g.length); });
    const err = sm.map((e, i) => Math.abs(Math.round(e) - B.y[i]));
    const rmse = Math.sqrt(sm.reduce((a, e, i) => a + (e - B.y[i]) ** 2, 0) / sm.length);
    const perCount = Array.from({ length: MAX_PEOPLE + 1 }, (_, n) => { const v = sm.filter((_, i) => B.y[i] === n); return v.reduce((a, x) => a + x, 0) / v.length; });
    m.rmse = rmse;
    setModel(m);
    sim.current.recent = [];
    setResult({ exact: mean(err.map((e) => e === 0)), w1: mean(err.map((e) => e <= 1)), w2: mean(err.map((e) => e <= 2)), rmse, perCount, rows: A.X.length + B.X.length, env: ENVS[env].label });
    log(`[lab] model trained on ${A.X.length} windows, tested on ${B.X.length} unseen windows`);
    setTraining(null);
  };

  const exportCsv = () => {
    const s = sim.current;
    const head = ["t", "session", "label", "source", ...featureNames()].join(",");
    const lines = s.history.map((r, i) => [new Date(Date.now() - (s.history.length - i) * 2000).toISOString(), "lab", s.people.length, "simulation", ...r].join(","));
    const blob = new Blob([[head, ...lines].join("\n") + "\n"], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "ghostslot_lab_simulated.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  // ---- derived view data ----
  const people = snap.people;
  const truth = people.length;
  const reports = snap.reports;
  const maxMotion = 160;
  const linkColor = (m) => {
    if (m == null) return "rgba(255,107,107,0.35)";
    const k = Math.max(0, Math.min(1, (m - 45) / (maxMotion - 45)));
    return `rgba(${Math.round(139 + 102 * k)},${Math.round(92 + 135 * k)},${Math.round(246 + 9 * k)},${0.25 + 0.75 * k})`;
  };
  const pairMotion = (pi) => {
    if (!reports) return null;
    const vals = P.LINKS.map((l, i) => (P.PAIRS[pi].includes(l[0]) && P.PAIRS[pi].includes(l[1]) && reports[i] ? reports[i].motion : null)).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const est = estimate && model ? estimate : null;
  const estN = est ? Math.round(est.value) : null;
  const estOk = est ? Math.abs(Math.round(est.value) - truth) <= 1 : null;
  const amps = snap.amps?.[linkSel];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "Inter, system-ui, sans-serif" }}>
      <style>{`
        .lab-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 16px; }
        @media (max-width: 900px) { .lab-grid { grid-template-columns: 1fr; } }
        .lab-btn:focus-visible { outline: 2px solid #C4B5FD; outline-offset: 2px; }
      `}</style>
      <header style={{ padding: "18px 16px 8px", maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <a href="/" style={{ color: C.silver, textDecoration: "none", fontFamily: head, fontWeight: 700, fontSize: 20 }}>Ghost<span style={{ color: C.violet }}>Slot</span></a>
            <h1 style={{ fontFamily: head, fontSize: 22, margin: 0 }}>Sensing Lab</h1>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#0A0812", background: C.warn, borderRadius: 999, padding: "3px 10px" }}>SIMULATION</span>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 13.5, color: C.sub, maxWidth: 720, lineHeight: 1.5 }}>
            A virtual 6 × 6 m room with 4 ESP32-S3 nodes and 12 Wi-Fi links. You move the people; the CSI readings come from a 2.4 GHz
            multipath physics model and are processed exactly like our firmware (gain normalisation → 2 s variance).
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="lab-btn" style={btn(running)} onClick={() => setRunning((r) => !r)}>{running ? "⏸ Pause" : "▶ Run"}</button>
          <span style={{ fontFamily: mono, fontSize: 13, color: C.sub, alignSelf: "center" }}>t = {snap.t.toFixed(0)} s</span>
        </div>
      </header>

      <main className="lab-grid" style={{ maxWidth: 1200, margin: "0 auto", padding: "8px 16px 40px" }}>
        {/* ---------------- left: room + controls ---------------- */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <Card>
            <svg ref={svgRef} viewBox={`0 0 ${VIEW} ${VIEW}`} style={{ width: "100%", display: "block", touchAction: "none", userSelect: "none" }}
              onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onClick={onFloor} role="application" aria-label="Virtual room. Click the floor to add a person or send the selected person there; drag people to move them.">
              <defs>
                <pattern id="lab-grid" width={SCALE / 2} height={SCALE / 2} patternUnits="userSpaceOnUse">
                  <path d={`M ${SCALE / 2} 0 L 0 0 0 ${SCALE / 2}`} fill="none" stroke="rgba(196,181,253,0.06)" strokeWidth="1" />
                </pattern>
                <radialGradient id="lab-person" cx="50%" cy="40%" r="60%"><stop offset="0%" stopColor="#F1ECFF" /><stop offset="100%" stopColor="#A78BFA" /></radialGradient>
              </defs>
              <rect x={PAD} y={PAD} width={P.ROOM.w * SCALE} height={P.ROOM.h * SCALE} fill="url(#lab-grid)" stroke="rgba(196,181,253,0.35)" strokeWidth="3" rx="6" />
              <text x={VIEW / 2} y={PAD - 9} textAnchor="middle" fill={C.muted} fontSize="13" fontFamily={mono}>FRONT · 6 m</text>
              <text x={VIEW / 2} y={VIEW - 8} textAnchor="middle" fill={C.muted} fontSize="13" fontFamily={mono}>BACK</text>
              {/* links (pairs drawn once; colour = average motion of both directions) */}
              {P.PAIRS.map(([a, b], pi) => {
                const A = P.NODES[a - 1], B = P.NODES[b - 1];
                const on = nodesOn[a - 1] && nodesOn[b - 1];
                const m = pairMotion(pi);
                const isSel = P.LINKS[linkSel] && P.PAIRS[pi].includes(P.LINKS[linkSel][0]) && P.PAIRS[pi].includes(P.LINKS[linkSel][1]);
                return <line key={pi} x1={PAD + A.x * SCALE} y1={PAD + A.y * SCALE} x2={PAD + B.x * SCALE} y2={PAD + B.y * SCALE}
                  stroke={on ? linkColor(m) : "rgba(255,107,107,0.25)"} strokeWidth={isSel ? 7 : 4} strokeDasharray={on ? "" : "8 8"} strokeLinecap="round" />;
              })}
              {/* people */}
              {people.map((p) => (
                <g key={p.id} transform={`translate(${PAD + p.x * SCALE} ${PAD + p.y * SCALE})`} onPointerDown={(e) => onDown(e, p.id)} onClick={(e) => e.stopPropagation()} style={{ cursor: "grab" }}>
                  {selected === p.id && <circle r="27" fill="none" stroke={C.warn} strokeWidth="3" />}
                  <circle r="19" fill="url(#lab-person)" stroke="#07060C" strokeWidth="2" />
                  <text y="5" textAnchor="middle" fontSize="15" fontWeight="700" fill="#0A0812" fontFamily={head}>{p.id}</text>
                  {p.activity === "walk" && <text y="-25" textAnchor="middle" fontSize="12" fill={C.silver}>walking</text>}
                  {p.activity === "still" && <text y="-25" textAnchor="middle" fontSize="12" fill={C.muted}>still</text>}
                </g>
              ))}
              {/* nodes */}
              {P.NODES.map((n, i) => (
                <g key={n.id} transform={`translate(${PAD + n.x * SCALE} ${PAD + n.y * SCALE})`}>
                  <rect x="-20" y="-14" width="40" height="28" rx="6" fill={nodesOn[i] ? "#1B1732" : "#2A1518"} stroke={nodesOn[i] ? C.silver : C.bad} strokeWidth="2" />
                  <text y="5" textAnchor="middle" fontSize="13" fontWeight="700" fill={nodesOn[i] ? C.text : C.bad} fontFamily={mono}>S3·{n.id}</text>
                </g>
              ))}
            </svg>
            <div style={{ fontSize: 12.5, color: C.sub, marginTop: 8, lineHeight: 1.5 }}>
              Click the floor to add a person, or (with someone selected) to send them there. Drag to move. Keys: arrows/WASD move the selected person, + / − add or remove.
            </div>
          </Card>

          <Card title={`People in the room: ${truth}`} sub="You are in control. The detector never sees these numbers, only the Wi-Fi readings.">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <button className="lab-btn" style={btn()} onClick={() => addPerson()} disabled={truth >= MAX_PEOPLE}>+ Add person</button>
              <button className="lab-btn" style={btn()} onClick={() => removePerson(selected)} disabled={!truth}>− Remove{selected ? ` #${selected}` : ""}</button>
              <span style={{ fontSize: 13, color: C.sub, marginLeft: 6 }}>Set count:</span>
              {Array.from({ length: MAX_PEOPLE + 1 }, (_, n) => (
                <button key={n} className="lab-btn" style={{ ...btn(truth === n), padding: "6px 9px", minWidth: 34 }} onClick={() => setCount(n)}>{n}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: C.sub }}>Everyone:</span>
              {ACTS.map(([k, l]) => <button key={k} className="lab-btn" style={btn()} onClick={() => allActivity(k)}>{l}</button>)}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: C.sub }}>Formation:</span>
              <button className="lab-btn" style={btn()} onClick={() => formation("spread")}>Spread out</button>
              <button className="lab-btn" style={btn()} onClick={() => formation("centre")}>Huddle in centre</button>
              <button className="lab-btn" style={btn()} onClick={() => formation("front")}>Line at front</button>
              <button className="lab-btn" style={btn()} onClick={() => formation("diag")}>On the 1→4 link</button>
            </div>
            {selected != null && people.some((p) => p.id === selected) && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12, alignItems: "center", paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 13, color: C.warn, fontWeight: 600 }}>Person #{selected}:</span>
                {ACTS.map(([k, l]) => <button key={k} className="lab-btn" style={btn(people.find((p) => p.id === selected)?.activity === k)} onClick={() => setActivity(selected, k)}>{l}</button>)}
                <button className="lab-btn" style={btn()} onClick={() => setSelected(null)}>Deselect</button>
              </div>
            )}
          </Card>

          <Card title="Environment & boards">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: C.sub }}>Background Wi-Fi:</span>
              {Object.entries(ENVS).map(([k, v]) => <button key={k} className="lab-btn" style={btn(env === k)} onClick={() => setEnv(k)}>{v.label}</button>)}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
              <span style={{ fontSize: 13, color: C.sub }}>Boards:</span>
              {P.NODES.map((n, i) => (
                <button key={n.id} className="lab-btn" style={btn(nodesOn[i], nodesOn[i] ? undefined : "rgba(255,107,107,0.5)")}
                  onClick={() => setNodesOn((o) => o.map((v, j) => (j === i ? !v : v)))} aria-pressed={nodesOn[i]}>
                  S3·{n.id} {nodesOn[i] ? "ON" : "OFF"}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 12.5, color: C.sub, marginTop: 8 }}>Switch a board off to see what happens when one drops out (like our C3 did at the venue).</div>
          </Card>
        </div>

        {/* ---------------- right: detector, links, CSI, serial, lab ---------------- */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <Card title="Detector" sub="Estimated only from the 12 links' readings, smoothed over 6 s.">
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 120px", background: "rgba(196,181,253,0.04)", borderRadius: 14, padding: 12 }}>
                <div style={{ fontSize: 12, color: C.sub }}>Actually inside</div>
                <div style={{ fontFamily: head, fontSize: 38, fontWeight: 700 }}>{truth}</div>
              </div>
              <div style={{ flex: "1 1 160px", background: est ? (estOk ? "rgba(61,220,151,0.08)" : "rgba(245,181,68,0.08)") : "rgba(196,181,253,0.04)", borderRadius: 14, padding: 12, border: `1px solid ${est ? (estOk ? "rgba(61,220,151,0.35)" : "rgba(245,181,68,0.35)") : "transparent"}` }}>
                <div style={{ fontSize: 12, color: C.sub }}>Wi-Fi estimate</div>
                {est ? (
                  <>
                    <div style={{ fontFamily: head, fontSize: 38, fontWeight: 700 }}>≈{estN}</div>
                    <div style={{ fontSize: 12.5, color: C.sub }}>likely {Math.max(0, Math.round(est.value - est.rmse))}–{Math.round(est.value + est.rmse)} · {estOk ? "within ±1 ✓" : "off by more than 1"}</div>
                  </>
                ) : <div style={{ fontSize: 13.5, color: C.sub, marginTop: 8, lineHeight: 1.5 }}>Not trained yet. Run the lab steps below.</div>}
              </div>
            </div>
          </Card>

          <Card title="12 links" sub="Motion = variation of the normalised CSI over the last 2 s (×1000). Tap a link to plot its CSI.">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 6 }}>
              {P.LINKS.map((l, i) => {
                const r = reports?.[i];
                const k = r ? Math.max(0, Math.min(1, (r.motion - 45) / (maxMotion - 45))) : 0;
                return (
                  <button key={i} className="lab-btn" onClick={() => setLinkSel(i)} aria-pressed={linkSel === i}
                    style={{ ...btn(linkSel === i), textAlign: "left", padding: "7px 9px", display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ display: "flex", justifyContent: "space-between", fontFamily: mono, fontSize: 12.5 }}>
                      <b>{P.LINK_NAMES[i]}</b><span>{r ? r.motion.toFixed(0) : "off"}</span>
                    </span>
                    <span aria-hidden style={{ height: 6, borderRadius: 3, background: "rgba(196,181,253,0.08)", overflow: "hidden" }}>
                      <span style={{ display: "block", height: 6, width: `${r ? 4 + k * 96 : 0}%`, background: linkColor(r?.motion) }} />
                    </span>
                    <span style={{ fontSize: 11.5, color: C.muted, fontFamily: mono }}>{r ? `${r.rssi.toFixed(1)} dBm` : "board off"}</span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card title={`CSI amplitude · link ${P.LINK_NAMES[linkSel]}`} sub="52 subcarriers of the latest packet (2.437 GHz, 312.5 kHz apart). People change the ripples.">
            <CsiPlot amps={amps} />
          </Card>

          <Card title="Lab: calibrate → train → test" sub="Same workflow as the real boards, but with simulated recordings. The test uses a separate session the model never saw.">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="lab-btn" style={btn(!!baseline)} onClick={calibrate} disabled={!!training}>1 · Calibrate empty room {baseline ? "✓" : ""}</button>
              <button className="lab-btn" style={primary} onClick={train} disabled={!!training}>2 · Record 0–10 &amp; train</button>
              <button className="lab-btn" style={btn()} onClick={exportCsv} disabled={!snap.row}>Download live CSV</button>
            </div>
            {training && (
              <div style={{ marginTop: 12 }} role="status">
                <div style={{ fontSize: 13, color: C.sub }}>{training.step}</div>
                <div style={{ height: 8, borderRadius: 4, background: "rgba(196,181,253,0.08)", marginTop: 6, overflow: "hidden" }}>
                  <div style={{ height: 8, width: `${training.pct}%`, background: C.violet, transition: "width .2s" }} />
                </div>
              </div>
            )}
            {result && !training && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[["Exact", result.exact], ["Within ±1", result.w1], ["Within ±2", result.w2]].map(([l, v]) => (
                    <div key={l} style={{ flex: "1 1 90px", background: "rgba(196,181,253,0.04)", borderRadius: 12, padding: 10 }}>
                      <div style={{ fontFamily: head, fontSize: 24, fontWeight: 700 }}>{Math.round(v * 100)}%</div>
                      <div style={{ fontSize: 12, color: C.sub }}>{l} (unseen session)</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 13, color: C.sub, margin: "10px 0 6px" }}>Average estimate for each true count ({result.rows} simulated windows, {result.env}):</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(11, minmax(0,1fr))", gap: 3, alignItems: "end", height: 90 }} aria-label="Average estimate per true count">
                  {result.perCount.map((v, n) => (
                    <div key={n} title={`true ${n}: estimate ${v.toFixed(1)}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, height: "100%", justifyContent: "flex-end" }}>
                      <span style={{ fontSize: 10.5, fontFamily: mono, color: C.sub }}>{v.toFixed(1)}</span>
                      <span style={{ width: "70%", height: `${Math.max(3, (v / MAX_PEOPLE) * 62)}px`, background: Math.abs(v - n) <= 1 ? C.good : C.warn, borderRadius: 3 }} />
                      <span style={{ fontSize: 11, fontFamily: mono }}>{n}</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
                  Green = average within ±1 of the truth. Accuracy drops for large crowds: bodies block each other and their signals overlap, the same limit real Wi-Fi sensing has.
                </div>
              </div>
            )}
          </Card>

          <Card title="Serial monitor" sub="What each board would print (simulated).">
            <pre aria-live="off" style={{ margin: 0, background: "#07060C", borderRadius: 10, padding: 10, height: 180, overflow: "auto", fontFamily: mono, fontSize: 11.5, color: "#CFC7EC", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              {snap.log.slice(-40).join("\n") || "waiting for the first 2 s window…"}
            </pre>
          </Card>
        </div>
      </main>
      <footer style={{ maxWidth: 1200, margin: "0 auto", padding: "0 16px 30px", fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
        Simulation, not a measurement. Radio model: direct path + first-order wall reflections + one scattered path per person, first-Fresnel-zone
        blocking, receiver noise and AGC jitter. Live hardware results are on the Demo Room card in the app.
      </footer>
    </div>
  );
}

function CsiPlot({ amps }) {
  const W = 520, H = 150, pad = 26;
  const path = useMemo(() => {
    if (!amps) return null;
    const arr = Array.from(amps);
    const mx = Math.max(...arr), mn = Math.min(...arr);
    const span = Math.max(mx - mn, mx * 0.15) || 1; // zoom on the ripples, never flatter than ±7.5 %
    const lo = (mx + mn) / 2 - span / 2;
    return arr.map((v, i) => `${i ? "L" : "M"} ${pad + (i / (arr.length - 1)) * (W - pad * 2)} ${H - pad - ((v - lo) / span) * (H - pad * 2)}`).join(" ");
  }, [amps]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img" aria-label="CSI amplitude across 52 subcarriers">
      <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="rgba(196,181,253,0.2)" />
      <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="rgba(196,181,253,0.2)" />
      {path ? <path d={path} fill="none" stroke="#C4B5FD" strokeWidth="2.2" strokeLinejoin="round" /> : <text x={W / 2} y={H / 2} textAnchor="middle" fill="#857DA8" fontSize="13">link off</text>}
      <text x={W / 2} y={H - 6} textAnchor="middle" fill="#A39CC4" fontSize="11" fontFamily="'JetBrains Mono', monospace">subcarrier −26 … +26</text>
      <text x={8} y={pad - 8} fill="#A39CC4" fontSize="11" fontFamily="'JetBrains Mono', monospace">|H|</text>
    </svg>
  );
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const mean = (a) => a.reduce((x, y) => x + (y ? 1 : 0), 0) / a.length;
function featureNames() {
  const out = [];
  for (const [a, b] of P.PAIRS) {
    const n = `p${a}-${b}`;
    out.push(`${n}_motion`, `${n}_rssi`, ...Array.from({ length: P.GROUPS }, (_, g) => `${n}_prof${g}`));
  }
  return [...out, "motion_mean", "motion_max", "motion_std", "links_present"];
}
