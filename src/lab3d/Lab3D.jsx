// Live Sensing Room (/lab3d): a 3-D simulation of a GhostSlot room with
// 4 ESP32-S3 boards (12 Wi-Fi links), an IR door counter and the door QR.
// Three independent signals are compared: IR door count, QR check-ins and
// the Wi-Fi estimate. "Play the story" walks a judge through the concept.
// Everything here is a SIMULATION and says so.
import React, { useEffect, useRef, useState } from "react";
import * as P from "../lab/physics";
import * as S from "./sim";
import { createScene } from "./scene";

const C = { bg: "#07060C", card: "rgba(18,15,30,0.92)", border: "rgba(196,181,253,0.14)", text: "#F4F1FF", sub: "#A39CC4", muted: "#857DA8",
  silver: "#C4B5FD", violet: "#8B5CF6", good: "#3DDC97", warn: "#F5B544", bad: "#FF6B6B" };
const head = "'Space Grotesk', sans-serif", mono = "'JetBrains Mono', monospace";
const PACKET_DT = P.WINDOW_S / P.PACKETS_PER_WINDOW;
const ENV = { noise: 0.13, agc: 0.08 };
const TONE = { good: C.good, warn: C.warn, bad: C.bad, muted: C.muted };

const btn = (on = false, tone) => ({
  background: on ? "rgba(167,139,250,0.22)" : "rgba(18,15,30,0.8)", color: on ? "#F1ECFF" : "#D2C8F5",
  border: `1px solid ${on ? "rgba(167,139,250,0.6)" : tone || "rgba(196,181,253,0.2)"}`, borderRadius: 10,
  padding: "8px 12px", fontSize: 13, cursor: "pointer", fontFamily: "inherit", minHeight: 36, whiteSpace: "nowrap",
});
const primary = { ...btn(), background: "linear-gradient(180deg, #F1ECFF, #A78BFA)", color: "#0A0812", border: "none", fontWeight: 700 };
const Panel = ({ title, sub, children }) => (
  <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 14 }}>
    {title && <h3 style={{ fontFamily: head, fontSize: 15.5, margin: 0 }}>{title}</h3>}
    {sub && <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3, lineHeight: 1.45 }}>{sub}</div>}
    <div style={{ marginTop: title || sub ? 10 : 0 }}>{children}</div>
  </section>
);

export default function Lab3D() {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const sim = useRef({
    agents: [], door: S.makeDoorCounter(), t: 0, acc: 0, packets: 0, win: P.newWindow(), R: P.rng((Date.now() % 1e9) | 0),
    nodesOn: [true, true, true, true], reports: null, row: null, recent: [], scheduled: [], qr: 0, log: [],
  });
  const [ui, setUi] = useState({ agents: [], beams: { a: false, b: false }, door: { entries: 0, exits: 0, seq: [] }, qr: 0, reports: null, t: 0, log: [] });
  const [selected, setSelected] = useState(null);
  const [blind, setBlind] = useState(false);
  const [feel, setFeel] = useState(false);
  const [highlight, setHighlight] = useState([]);
  const [nodesOn, setNodesOn] = useState([true, true, true, true]);
  const [fresnelPair, setFresnelPair] = useState(2);
  const [showFresnel, setShowFresnel] = useState(false);
  const [model, setModel] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [train, setTrain] = useState({ pct: 0 });
  const [estimate, setEstimate] = useState(null);
  const [speed, setSpeed] = useState(1);
  const [story, setStory] = useState(null); // { step, caption, total }
  const [autoRotate, setAutoRotate] = useState(true);

  const refs = useRef({});
  Object.assign(refs.current, { model, baseline, speed, selected, blind, feel, highlight, fresnelPair, showFresnel, autoRotate, nodesOn });

  useEffect(() => { sim.current.nodesOn = nodesOn; if (nodesOn.filter(Boolean).length < 2) { sim.current.recent = []; setEstimate(null); } }, [nodesOn]);

  const log = (text, kind = "info") => {
    const s = sim.current;
    s.log.push({ t: s.t, text, kind });
    if (s.log.length > 60) s.log.shift();
  };

  // ---- calibrate the empty room and train the Wi-Fi detector on simulated recordings ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const R = P.rng(777);
      const base = P.baselineFrom(Array.from({ length: 5 }, (_, i) => P.simulateWindow([], ENV, R, i * 2)));
      const X = [], y = [];
      for (let n = 0; n <= 10; n++) {
        for (let w = 0; w < 14; w++) {
          const ppl = P.randomPeople(n, R);
          ppl.forEach((p) => { p.by = p.y = 0.6 + R.next() * 4.9; p.bx = p.x = 0.5 + R.next() * 5; });
          X.push(P.detectorInputs(P.simulateWindow(ppl, ENV, R, w * 2), base)); y.push(n);
        }
        if (cancelled) return;
        setTrain({ pct: Math.round(((n + 1) / 11) * 100) });
        await new Promise((r) => setTimeout(r, 0));
      }
      const m = P.fitRidge(X, y, 2);
      const res = X.map((x, i) => P.predictRidge(m, x) - y[i]);
      m.rmse = Math.sqrt(res.reduce((a, r) => a + r * r, 0) / res.length);
      if (!cancelled) { setBaseline(base); setModel(m); setTrain(null); }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- 3-D scene ----
  useEffect(() => {
    const api = createScene(canvasRef.current, {
      onPick: (id) => { setSelected(id); setAutoRotate(false); },
      onFloor: (x, y) => {
        const a = sim.current.agents.find((q) => q.id === refs.current.selected);
        if (a && y > 0.3) { S.moveAgentTo(a, x, y); log(`${a.name} walks to (${x.toFixed(1)}, ${y.toFixed(1)}) m`); }
      },
    });
    sceneRef.current = api;
    return () => api.dispose();
  }, []);

  // ---- simulation loop ----
  useEffect(() => {
    let raf, last = performance.now(), lastUi = 0;
    const hooks = {
      onCheckIn: (a) => { sim.current.qr++; log(`${a.name} scanned the door QR → checked in`, "qr"); },
      onCheckOut: (a) => { sim.current.qr = Math.max(0, sim.current.qr - 1); log(`${a.name} checked out on the way out`, "qr"); },
    };
    const finishWindow = () => {
      const s = sim.current, R = refs.current;
      s.reports = s.win.map(P.linkReport);
      s.row = P.windowFeatures(s.win);
      s.win = P.newWindow();
      if (R.model && R.baseline && s.nodesOn.filter(Boolean).length >= 2 && s.row[s.row.length - 1] > 0) {
        const e = P.predictRidge(R.model, P.detectorInputs(s.row, R.baseline));
        s.recent.push(e); if (s.recent.length > 3) s.recent.shift();
        setEstimate({ value: Math.max(0, s.recent.reduce((a, x) => a + x, 0) / s.recent.length), rmse: R.model.rmse });
      } else setEstimate(null);
    };
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const s = sim.current, R = refs.current;
      const dtReal = Math.min(0.05, (now - last) / 1000) * R.speed; last = now;
      s.scheduled = s.scheduled.filter((ev) => { if (s.t >= ev.at) { ev.run(); return false; } return true; });
      let rem = dtReal;
      while (rem > 1e-6) {
        const d = Math.min(rem, 1 / 120); rem -= d; s.t += d;
        for (const a of s.agents) S.stepAgent(a, d, hooks);
        const before = s.door.events.length;
        S.stepDoorCounter(s.door, s.agents, s.t);
        if (s.door.events.length > before) { const e = s.door.events[s.door.events.length - 1]; log(`IR door: ${e.text}`, e.kind); }
        s.acc += d;
        while (s.acc >= PACKET_DT) {
          s.acc -= PACKET_DT;
          P.samplePacket(s.win, s.agents.filter(S.isInside).map(S.radioPos), ENV, s.R, s.nodesOn);
          if (++s.packets % P.PACKETS_PER_WINDOW === 0) finishWindow();
        }
      }
      s.agents = s.agents.filter((a) => a.state !== "gone");
      sceneRef.current?.update({
        agents: s.agents, beams: s.door.beams, nodesOn: s.nodesOn, blind: R.blind, selectedId: R.selected,
        highlight: new Set(R.highlight), fresnelPair: R.fresnelPair, showFresnel: R.showFresnel, showFeel: R.feel && !R.blind,
        autoRotate: R.autoRotate, pairLevel: pairLevels(s.reports),
      });
      if (now - lastUi > 150) {
        lastUi = now;
        setUi({ agents: s.agents.map((a) => ({ id: a.id, name: a.name, state: a.state, checkedIn: a.checkedIn, x: a.x, y: a.y, seated: a.seated })),
          beams: { ...s.door.beams }, door: { entries: s.door.entries, exits: s.door.exits, seq: [...s.door.seq] }, qr: s.qr, reports: s.reports, t: s.t, log: [...s.log] });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- people + scenarios ----
  const s = sim.current;
  const freeSeat = () => S.SEATS.find((seat) => !s.agents.some((a) => a.seat === seat && a.state !== "leaving")) || null;
  const enter = (scans, delay = 0, extra = {}) => {
    const a = S.makeAgent({ scans, seat: freeSeat(), delay });
    if (extra.turnBack) { a.turnBack = true; a.seat = null; }
    s.agents.push(a);
    return a;
  };
  const resetRoom = () => {
    S.resetIds();
    s.agents = []; s.door = S.makeDoorCounter(); s.qr = 0; s.scheduled = []; s.log = []; s.recent = [];
    setSelected(null); setEstimate(null); setHighlight([]); setBlind(false); setFeel(false);
  };
  const at = (sec, run) => s.scheduled.push({ at: s.t + sec, run });
  const tenSevenThree = () => {
    resetRoom();
    [true, true, false, true, true, false, true, true, false, true].forEach((scans, i) => enter(scans, 0.5 + i * 2.6));
    log("10 people walk in one by one. 7 scan the door QR, 3 walk straight to a seat.");
  };
  const scenarios = [
    ["10 enter · 7 scan · 3 don't", tenSevenThree],
    ["Tailgating (2 enter together)", () => { enter(true, 0.2); enter(false, 0.55); log("Two people walk through the door almost together."); }],
    ["Half-enter, turn back", () => { enter(false, 0.2, { turnBack: true }); log("Someone steps into the doorway and turns back. IR must not count it."); }],
    ["One person leaves", () => { const a = [...s.agents].reverse().find((q) => q.seated || q.state === "idle"); if (a) { S.startLeaving(a); log(`${a.name} gets up and leaves`); } }],
    ["Everyone leaves", () => { s.agents.filter((q) => q.seated || q.state === "idle").forEach((a, i) => at(i * 1.6, () => S.startLeaving(a))); log("Everyone leaves one by one."); }],
    ["Ghost booking", () => { resetRoom(); s.qr = 1; log("Someone checked in from the app but nobody is in the room."); }],
  ];

  // ---- story mode: a guided 1-minute walk through the concept ----
  const storyRun = useRef(0);
  const playStory = async () => {
    const id = ++storyRun.current;
    const alive = () => storyRun.current === id;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (cond, maxMs) => { const t0 = performance.now(); while (alive() && !cond() && performance.now() - t0 < maxMs) await wait(200); };
    const cam = (v, d) => sceneRef.current?.flyTo(v, d);
    const step = (i, caption, sub) => alive() && setStory({ step: i, total: 8, caption, sub });
    setAutoRotate(false); setShowFresnel(false); setSpeed(2); resetRoom(); setNodesOn([true, true, true, true]);
    step(1, "A normal classroom. Four ESP32-S3 boards in the corners.", "They talk to each other over Wi-Fi: 12 links, many times a second. No cameras anywhere.");
    cam("boards", 2.2); await wait(5500); if (!alive()) return;
    step(2, "At the door: two infrared beams.", "Break A, then B = someone came IN. Break B, then A = someone went OUT. Half a step in and back = ignored.");
    cam("door", 2); tenSevenThree(); await wait(6500); if (!alive()) return;
    step(3, "Just inside: the door QR.", "Most people scan it to check in. Some don't bother.");
    cam("qr", 1.8); await until(() => sim.current.qr >= 2, 9000); await wait(1500); if (!alive()) return;
    step(4, "Ten people walk in. Seven scan. Three don't.", "Green = checked in · amber = not checked in.");
    cam("seats", 2.2); await until(() => sim.current.agents.filter((a) => a.seated).length >= 10, 40000); await wait(800); if (!alive()) return;
    step(5, "Wi-Fi: every body bends the signals between the boards.", "The model only reads how the 12 links change. It estimates how many people are inside.");
    setFeel(true); cam("iso", 2.2); await wait(7000); if (!alive()) return;
    const unscanned = sim.current.agents.filter((a) => !a.checkedIn).map((a) => a.id);
    const w = Math.round(sim.current.recent.length ? sim.current.recent.reduce((a, x) => a + x, 0) / sim.current.recent.length : 0);
    step(6, `Door counter 10 · QR 7 · Wi-Fi ≈${w}`, "→ 3 people are in this room without checking in. GhostSlot still shows the room as occupied and tells staff the real count.");
    setHighlight(unscanned); setFeel(false); cam("wide", 2); await wait(8000); if (!alive()) return;
    step(7, "Proof it's Wi-Fi: hide the people.", "The estimate keeps working. It never sees the people, only the signals.");
    setHighlight([]); setBlind(true); await wait(7500); if (!alive()) return;
    step(8, "And Wi-Fi grades itself every day.", "Whenever the door count and check-ins agree, that's free ground truth. Every room gets an accuracy score, and an empty room at night re-calibrates it.");
    setBlind(false); cam("iso", 2); await wait(8000); if (!alive()) return;
    setStory({ step: 9, total: 8, caption: "QR tells us who. IR tells us how many, and which way. Wi-Fi proves it independently.", sub: "Find space, don't waste space. That's GhostSlot.", done: true });
    setSpeed(1); setAutoRotate(true);
  };
  const stopStory = () => { storyRun.current++; setStory(null); setSpeed(1); setBlind(false); setFeel(false); setHighlight([]); };

  // ---- derived numbers ----
  const actual = ui.agents.filter((a) => a.y > 0.02 && a.state !== "waiting").length;
  const ir = Math.max(0, ui.door.entries - ui.door.exits);
  const wifiOn = nodesOn.filter(Boolean).length >= 2;
  const wifi = estimate && wifiOn ? estimate.value : null;
  const verdicts = S.verdict({ ir, qr: ui.qr, wifi, wifiOn });
  const sel = ui.agents.find((a) => a.id === selected);
  const why = whyLinks(ui.reports, ui.agents);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "Inter, system-ui, sans-serif" }}>
      <style>{`
        .l3-stage { position: relative; width: 100%; height: min(80vh, 860px); }
        .l3-canvas { width: 100%; height: 100%; display: block; touch-action: none; }
        @media (max-width: 700px) { .l3-stage { height: 70vh; } .l3-hud { transform: scale(0.86); transform-origin: top left; } }
        .l3-btn:focus-visible { outline: 2px solid #C4B5FD; outline-offset: 2px; }
        .l3-explore { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
        @keyframes l3-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        .l3-cap { animation: l3-in .5s ease; }
      `}</style>

      {/* ---------- stage ---------- */}
      <div className="l3-stage">
        <canvas ref={canvasRef} className="l3-canvas" aria-label="3-D classroom. Drag to rotate, scroll or pinch to zoom, click a person to select them, click the floor to send them there." />

        {/* top bar */}
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, padding: "14px 16px", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", pointerEvents: "none", background: "linear-gradient(180deg, rgba(7,6,12,0.85), rgba(7,6,12,0))" }}>
          <div style={{ pointerEvents: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <a href="/" style={{ color: C.silver, textDecoration: "none", fontFamily: head, fontWeight: 700, fontSize: 19 }}>Ghost<span style={{ color: C.violet }}>Slot</span></a>
              <h1 style={{ fontFamily: head, fontSize: 19, margin: 0 }}>Live Sensing Room</h1>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#0A0812", background: C.warn, borderRadius: 999, padding: "3px 9px" }}>SIMULATION</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, pointerEvents: "auto", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {!story && <button className="l3-btn" style={{ ...primary, padding: "10px 16px", fontSize: 14 }} onClick={playStory} disabled={!!train}>{train ? `Calibrating Wi-Fi… ${train.pct}%` : "▶ Play the story"}</button>}
            {story && <button className="l3-btn" style={btn()} onClick={stopStory}>■ Stop story</button>}
            <a href="/" className="l3-btn" style={{ ...btn(), textDecoration: "none", display: "inline-flex", alignItems: "center" }}>← App</a>
          </div>
        </div>

        {/* HUD: the three signals + verdict */}
        <div className="l3-hud" style={{ position: "absolute", left: 14, top: 64, display: "flex", flexDirection: "column", gap: 8, maxWidth: 330, pointerEvents: "none" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <Hud label="IR door" value={ir} color="#FF8B8B" />
            <Hud label="QR check-ins" value={ui.qr} color={C.good} />
            <Hud label="Wi-Fi" value={wifi == null ? "—" : `≈${Math.round(wifi)}`} color={C.silver} />
          </div>
          {verdicts.slice(0, 2).map((v, i) => (
            <div key={i} style={{ background: "rgba(14,11,24,0.82)", border: `1px solid ${TONE[v.tone]}55`, borderRadius: 12, padding: "7px 10px", fontSize: 13, lineHeight: 1.4, display: "flex", gap: 7 }}>
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: 99, background: TONE[v.tone], marginTop: 5, flexShrink: 0 }} />{v.text}
            </div>
          ))}
        </div>

        {/* view buttons */}
        <div style={{ position: "absolute", right: 14, top: 64, display: "flex", flexDirection: "column", gap: 6 }}>
          {[["iso", "3-D"], ["top", "Top"], ["door", "Door"], ["seats", "Desks"]].map(([k, l]) => (
            <button key={k} className="l3-btn" style={btn()} onClick={() => { setAutoRotate(false); sceneRef.current?.view(k); }}>{l}</button>
          ))}
          <button className="l3-btn" style={btn(autoRotate)} onClick={() => setAutoRotate((v) => !v)} aria-pressed={autoRotate}>⟳</button>
        </div>

        {/* story caption */}
        {story && (
          <div key={story.step} className="l3-cap" role="status" style={{ position: "absolute", left: "50%", bottom: 22, transform: "translateX(-50%)", width: "min(860px, calc(100% - 28px))", background: "rgba(10,8,18,0.88)", border: "1px solid rgba(196,181,253,0.25)", borderRadius: 18, padding: "16px 20px", backdropFilter: "blur(8px)" }}>
            <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
              {Array.from({ length: story.total }, (_, i) => <span key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i < story.step ? C.violet : "rgba(196,181,253,0.15)" }} />)}
            </div>
            <div style={{ fontFamily: head, fontSize: "clamp(18px, 2.4vw, 26px)", fontWeight: 700, lineHeight: 1.25 }}>{story.caption}</div>
            {story.sub && <div style={{ fontSize: "clamp(13.5px, 1.5vw, 16px)", color: "#CFC7EC", marginTop: 6, lineHeight: 1.5 }}>{story.sub}</div>}
            {story.done && (
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button className="l3-btn" style={primary} onClick={playStory}>↻ Replay</button>
                <button className="l3-btn" style={btn()} onClick={() => setStory(null)}>Explore yourself</button>
              </div>
            )}
          </div>
        )}
        {blind && <div style={{ position: "absolute", right: 14, bottom: story ? 170 : 22, background: C.warn, color: "#0A0812", borderRadius: 10, padding: "6px 10px", fontSize: 13, fontWeight: 700 }}>People hidden · only Wi-Fi is watching</div>}
      </div>

      {/* ---------- explore (for questions) ---------- */}
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "16px 14px 40px" }}>
        <details>
          <summary style={{ cursor: "pointer", fontFamily: head, fontSize: 17, fontWeight: 700, padding: "8px 0" }}>Explore: scenarios, controls, the IR logic and the Wi-Fi proof</summary>
          <div className="l3-explore" style={{ marginTop: 10 }}>
            <Panel title="Scenarios" sub="Each one replays a judge's question.">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {scenarios.map(([name, run]) => <button key={name} className="l3-btn" style={{ ...btn(), textAlign: "left" }} onClick={() => { stopStory(); run(); }} disabled={!!train}>{name}</button>)}
                <button className="l3-btn" style={{ ...btn(false, "rgba(255,107,107,0.4)"), textAlign: "left" }} onClick={() => { stopStory(); resetRoom(); }}>Reset room</button>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10 }}>
                <span style={{ fontSize: 13, color: C.sub }}>Speed:</span>
                {[1, 2, 4].map((v) => <button key={v} className="l3-btn" style={btn(speed === v)} onClick={() => setSpeed(v)}>{v}×</button>)}
              </div>
            </Panel>

            <Panel title="Control the people" sub="Click someone in 3-D, then click the floor to send them there.">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="l3-btn" style={btn()} onClick={() => { const a = enter(true, 0.1); setSelected(a.id); }}>+ Enter &amp; scan</button>
                <button className="l3-btn" style={btn()} onClick={() => { const a = enter(false, 0.1); setSelected(a.id); }}>+ Enter, no scan</button>
              </div>
              {sel ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{sel.name} <span style={{ color: sel.checkedIn ? C.good : C.warn, fontWeight: 500 }}>· {sel.checkedIn ? "checked in" : "not checked in"}</span></div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    <button className="l3-btn" style={btn()} onClick={() => { const a = s.agents.find((q) => q.id === sel.id); if (a) S.startLeaving(a); }}>Walk out</button>
                    <button className="l3-btn" style={btn()} onClick={() => { const a = s.agents.find((q) => q.id === sel.id); if (a) S.moveAgentTo(a, 3, 3.2); }}>Stand in the middle</button>
                    <button className="l3-btn" style={btn()} onClick={() => setSelected(null)}>Deselect</button>
                  </div>
                </div>
              ) : <div style={{ fontSize: 13, color: C.sub, marginTop: 10 }}>No one selected.</div>}
              <div style={{ fontSize: 13, color: C.sub, margin: "12px 0 6px" }}>ESP32-S3 boards</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {P.NODES.map((n, i) => <button key={n.id} className="l3-btn" aria-pressed={nodesOn[i]} style={btn(nodesOn[i], nodesOn[i] ? undefined : "rgba(255,107,107,0.5)")} onClick={() => setNodesOn((o) => o.map((v, j) => (j === i ? !v : v)))}>S3·{n.id} {nodesOn[i] ? "ON" : "OFF"}</button>)}
              </div>
            </Panel>

            <Panel title="How the IR door counter knows IN from OUT" sub="Beam A outside, beam B inside, 18 cm apart at waist height.">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <Beam label="A" cut={ui.beams.a} /><Beam label="B" cut={ui.beams.b} />
                <span style={{ fontFamily: mono, fontSize: 13, color: C.sub, alignSelf: "center" }}>{ui.door.seq?.length ? ui.door.seq.map((x) => ["", "A", "B", "A+B"][x]).join(" → ") : "door clear"}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13.5, lineHeight: 1.5 }}>
                <div style={{ background: "rgba(61,220,151,0.07)", border: "1px solid rgba(61,220,151,0.3)", borderRadius: 10, padding: 8 }}><b>IN +1</b><br /><span style={{ fontFamily: mono, fontSize: 12.5 }}>A → A+B → B → clear</span></div>
                <div style={{ background: "rgba(255,107,107,0.07)", border: "1px solid rgba(255,107,107,0.3)", borderRadius: 10, padding: 8 }}><b>OUT −1</b><br /><span style={{ fontFamily: mono, fontSize: 12.5 }}>B → A+B → A → clear</span></div>
              </div>
              <div style={{ fontSize: 12.5, color: C.sub, marginTop: 8, lineHeight: 1.5 }}>Anything else is ignored. Blocked over 4 s = someone standing in the door, reset. Two people glued together can count as one: Wi-Fi catches that.</div>
              <div style={{ fontSize: 12.5, color: C.muted, marginTop: 8 }}>Actually inside right now: <b style={{ color: C.text }}>{actual}</b> (the system never sees this)</div>
            </Panel>

            <Panel title="Proof that it's Wi-Fi" sub="Three checks you can run right now.">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="l3-btn" style={btn(blind)} onClick={() => setBlind((b) => !b)}>{blind ? "Show people" : "Hide people"}</button>
                <button className="l3-btn" style={btn()} onClick={() => setNodesOn((o) => (o.every(Boolean) ? [false, false, false, false] : [true, true, true, true]))}>{nodesOn.every(Boolean) ? "All boards OFF" : "All boards ON"}</button>
                <button className="l3-btn" style={btn(showFresnel)} onClick={() => setShowFresnel((v) => !v)}>Fresnel zone</button>
              </div>
              {showFresnel && <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>{P.PAIR_NAMES.map((n, i) => <button key={n} className="l3-btn" style={{ ...btn(fresnelPair === i), padding: "6px 8px" }} onClick={() => setFresnelPair(i)}>{n}</button>)}</div>}
              <div style={{ fontSize: 13, color: C.sub, margin: "10px 0 6px" }}>Most disturbed links (motion) and who is in their zone:</div>
              {why.length === 0 && <div style={{ fontSize: 13, color: C.muted }}>Waiting for the next 2 s window…</div>}
              {why.map((w) => (
                <div key={w.pair} style={{ fontSize: 13, display: "grid", gridTemplateColumns: "44px 1fr 44px", gap: 8, alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontFamily: mono }}>{w.pair}</span>
                  <span style={{ height: 8, borderRadius: 4, background: "rgba(196,181,253,0.08)" }}><span style={{ display: "block", height: 8, borderRadius: 4, width: `${Math.min(100, w.level * 100)}%`, background: C.silver }} /></span>
                  <span style={{ fontFamily: mono, textAlign: "right" }}>{w.motion.toFixed(0)}</span>
                  <span style={{ gridColumn: "1 / -1", fontSize: 12, color: C.muted }}>{w.who.length ? `in its zone: ${w.who.join(", ")}` : "nobody on the line: reflections from people elsewhere"}</span>
                </div>
              ))}
            </Panel>

            <Panel title="Event log">
              <div aria-live="polite" style={{ background: "#07060C", borderRadius: 10, padding: 10, height: 240, overflow: "auto", fontFamily: mono, fontSize: 12, lineHeight: 1.55, display: "flex", flexDirection: "column-reverse" }}>
                <div>
                  {ui.log.length === 0 && <div style={{ color: C.muted }}>Nothing yet.</div>}
                  {ui.log.map((e, i) => <div key={i} style={{ color: e.kind === "in" ? C.good : e.kind === "out" ? "#FF8B8B" : e.kind === "skip" ? C.warn : e.kind === "qr" ? C.silver : "#CFC7EC" }}><span style={{ color: C.muted }}>{e.t.toFixed(1).padStart(5)}s </span>{e.text}</div>)}
                </div>
              </div>
            </Panel>
          </div>
        </details>
        <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, marginTop: 14 }}>
          Simulation, not a measurement. Wi-Fi: 2.4 GHz multipath model (direct path, wall reflections, one scattered path per person, Fresnel-zone blocking, noise, AGC),
          processed like GhostSlot firmware v2 and read by a detector trained on simulated recordings. IR: two beams 18 cm apart at 1 m, counted by sequence. Live hardware results are on the Demo Room card in the app.
        </p>
      </div>
    </div>
  );
}

function Hud({ label, value, color }) {
  return (
    <div style={{ background: "rgba(14,11,24,0.82)", border: "1px solid rgba(196,181,253,0.18)", borderRadius: 12, padding: "6px 12px", minWidth: 88 }}>
      <div style={{ fontSize: 11.5, color: "#A39CC4" }}>{label}</div>
      <div style={{ fontFamily: head, fontSize: 26, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}
function Beam({ label, cut }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, padding: "5px 10px", borderRadius: 999, border: `1px solid ${cut ? "rgba(255,107,107,0.2)" : "rgba(255,107,107,0.6)"}`, background: cut ? "rgba(255,107,107,0.05)" : "rgba(255,45,45,0.12)" }}>
      <span aria-hidden style={{ width: 22, height: 3, borderRadius: 2, background: cut ? "#552222" : "#ff2d2d", boxShadow: cut ? "none" : "0 0 8px #ff2d2d" }} />
      Beam {label}: <b>{cut ? "CUT" : "clear"}</b>
    </span>
  );
}
function pairLevels(reports) {
  if (!reports) return new Array(6).fill(0);
  return P.PAIRS.map(([a, b]) => {
    const v = P.LINKS.map((l, i) => ((l[0] === a && l[1] === b) || (l[0] === b && l[1] === a)) && reports[i] ? reports[i].motion : null).filter((x) => x != null);
    if (!v.length) return 0;
    return Math.max(0, Math.min(1, (v.reduce((x, y) => x + y, 0) / v.length - 50) / 90));
  });
}
function whyLinks(reports, agents) {
  if (!reports) return [];
  const levels = pairLevels(reports);
  return P.PAIRS.map(([a, b], i) => {
    const A = P.NODES[a - 1], B = P.NODES[b - 1];
    const L = Math.hypot(B.x - A.x, B.y - A.y), vx = B.x - A.x, vy = B.y - A.y;
    const who = agents.filter((p) => p.y > 0.02 && p.state !== "waiting").filter((p) => {
      const t = ((p.x - A.x) * vx + (p.y - A.y) * vy) / (L * L);
      if (t <= 0 || t >= 1) return false;
      const d = Math.hypot(p.x - (A.x + t * vx), p.y - (A.y + t * vy));
      return d < 1.6 * Math.sqrt(P.LAMBDA * L * t * (1 - t)) + 0.18;
    }).map((p) => p.name);
    const v = P.LINKS.map((l, j) => ((l[0] === a && l[1] === b) || (l[0] === b && l[1] === a)) && reports[j] ? reports[j].motion : null).filter((x) => x != null);
    return { pair: P.PAIR_NAMES[i], level: levels[i], motion: v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0, who };
  }).filter((w) => w.motion > 0).sort((x, y) => y.level - x.level).slice(0, 3);
}
