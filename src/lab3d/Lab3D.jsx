// Live Sensing Room (/lab3d): a 3-D simulation of a GhostSlot room with
// 4 ESP32-S3 boards (12 Wi-Fi links), an IR door counter and the door QR.
// Three independent signals are compared: IR door count, QR check-ins and
// the Wi-Fi estimate. Everything here is a SIMULATION and says so.
import React, { useEffect, useRef, useState } from "react";
import * as P from "../lab/physics";
import * as S from "./sim";
import { createScene } from "./scene";

const C = { bg: "#07060C", card: "rgba(18,15,30,0.92)", border: "rgba(196,181,253,0.14)", text: "#F4F1FF", sub: "#A39CC4", muted: "#857DA8",
  silver: "#C4B5FD", violet: "#8B5CF6", good: "#3DDC97", warn: "#F5B544", bad: "#FF6B6B", blue: "#5B9BEA" };
const head = "'Space Grotesk', sans-serif", mono = "'JetBrains Mono', monospace";
const PACKET_DT = P.WINDOW_S / P.PACKETS_PER_WINDOW;
const ENV = { noise: 0.13, agc: 0.08 };

const btn = (on = false, tone) => ({
  background: on ? "rgba(167,139,250,0.2)" : "rgba(196,181,253,0.05)", color: on ? "#F1ECFF" : "#D2C8F5",
  border: `1px solid ${on ? "rgba(167,139,250,0.6)" : tone || "rgba(196,181,253,0.18)"}`, borderRadius: 10,
  padding: "8px 11px", fontSize: 13, cursor: "pointer", fontFamily: "inherit", minHeight: 36, whiteSpace: "nowrap",
});
const primary = { ...btn(), background: "linear-gradient(180deg, #F1ECFF, #A78BFA)", color: "#0A0812", border: "none", fontWeight: 700 };
const Panel = ({ title, sub, children, style }) => (
  <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 14, ...style }}>
    {title && <h2 style={{ fontFamily: head, fontSize: 15.5, margin: 0 }}>{title}</h2>}
    {sub && <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3, lineHeight: 1.45 }}>{sub}</div>}
    <div style={{ marginTop: title || sub ? 10 : 0 }}>{children}</div>
  </section>
);
const TONE = { good: C.good, warn: C.warn, bad: C.bad, muted: C.muted };

export default function Lab3D() {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const sim = useRef({
    agents: [], door: S.makeDoorCounter(), t: 0, acc: 0, packets: 0, win: P.newWindow(), R: P.rng((Date.now() % 1e9) | 0),
    nodesOn: [true, true, true, true], reports: null, row: null, recent: [], scheduled: [], qr: 0, log: [],
  });
  const [ui, setUi] = useState({ agents: [], beams: { a: false, b: false }, door: { entries: 0, exits: 0, events: [] }, qr: 0, reports: null, t: 0, log: [] });
  const [selected, setSelected] = useState(null);
  const [blind, setBlind] = useState(false);
  const [nodesOn, setNodesOn] = useState([true, true, true, true]);
  const [fresnelPair, setFresnelPair] = useState(2);
  const [model, setModel] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [train, setTrain] = useState({ pct: 0, msg: "Calibrating the Wi-Fi model on simulated recordings…" });
  const [estimate, setEstimate] = useState(null);
  const [speed, setSpeed] = useState(1);
  const [tab, setTab] = useState("scenario");
  const modelRef = useRef(null); modelRef.current = model;
  const baseRef = useRef(null); baseRef.current = baseline;
  const speedRef = useRef(1); speedRef.current = speed;
  const selRef = useRef(null); selRef.current = selected;

  useEffect(() => { sim.current.nodesOn = nodesOn; if (!nodesOn.some(Boolean)) { sim.current.recent = []; setEstimate(null); } }, [nodesOn]);

  const log = (text, kind = "info") => {
    const s = sim.current;
    s.log.push({ t: s.t, text, kind });
    if (s.log.length > 50) s.log.shift();
  };

  // ---- one-time: calibrate the empty room and train the Wi-Fi detector (simulated recordings) ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const R = P.rng(777);
      const base = P.baselineFrom(Array.from({ length: 5 }, (_, i) => P.simulateWindow([], ENV, R, i * 2)));
      const X = [], y = [];
      const per = 14;
      for (let n = 0; n <= 10; n++) {
        for (let w = 0; w < per; w++) {
          const ppl = P.randomPeople(n, R);
          // people in this room sit behind desks or stand near the door, never inside the walls
          ppl.forEach((p) => { p.by = p.y = 0.6 + Math.random() * 4.9; p.bx = p.x = 0.5 + Math.random() * 5; });
          X.push(P.detectorInputs(P.simulateWindow(ppl, ENV, R, w * 2), base)); y.push(n);
        }
        if (cancelled) return;
        setTrain({ pct: Math.round(((n + 1) / 11) * 100), msg: `Calibrating the Wi-Fi model: simulated recordings with ${n} ${n === 1 ? "person" : "people"}…` });
        await new Promise((r) => setTimeout(r, 0));
      }
      const m = P.fitRidge(X, y, 2);
      const res = X.map((x, i) => P.predictRidge(m, x) - y[i]);
      m.rmse = Math.sqrt(res.reduce((a, r) => a + r * r, 0) / res.length);
      if (cancelled) return;
      setBaseline(base); setModel(m); setTrain(null);
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- 3-D scene ----
  useEffect(() => {
    const api = createScene(canvasRef.current, {
      onPick: (id) => setSelected(id),
      onFloor: (x, y) => {
        const a = sim.current.agents.find((q) => q.id === selRef.current);
        if (a && y > 0.3) { S.moveAgentTo(a, x, y); log(`#${a.id} told to walk to (${x.toFixed(1)}, ${y.toFixed(1)}) m`); }
      },
    });
    sceneRef.current = api;
    return () => api.dispose();
  }, []);

  // ---- simulation loop ----
  useEffect(() => {
    let raf, last = performance.now(), lastUi = 0;
    const hooks = {
      onCheckIn: (a) => { sim.current.qr++; log(`#${a.id} ${a.name} scanned the door QR → checked in`, "qr"); },
      onCheckOut: (a) => { sim.current.qr = Math.max(0, sim.current.qr - 1); log(`#${a.id} ${a.name} checked out on the way out`, "qr"); },
    };
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const s = sim.current;
      const dtReal = Math.min(0.05, (now - last) / 1000) * speedRef.current; last = now;
      // scheduled actions (scenarios)
      s.scheduled = s.scheduled.filter((ev) => { if (s.t >= ev.at) { ev.run(); return false; } return true; });
      // agents + door counter at a fine step so beams never miss a crossing
      let rem = dtReal;
      while (rem > 1e-6) {
        const d = Math.min(rem, 1 / 120); rem -= d; s.t += d;
        for (const a of s.agents) S.stepAgent(a, d, hooks);
        const before = s.door.events.length;
        S.stepDoorCounter(s.door, s.agents, s.t);
        if (s.door.events.length > before) { const e = s.door.events[s.door.events.length - 1]; log(`IR door: ${e.text}`, e.kind); }
        // radio packets
        s.acc += d;
        while (s.acc >= PACKET_DT) {
          s.acc -= PACKET_DT;
          const inside = s.agents.filter(S.isInside).map(S.radioPos);
          P.samplePacket(s.win, inside, ENV, s.R, s.nodesOn);
          if (++s.packets % P.PACKETS_PER_WINDOW === 0) finishWindow();
        }
      }
      s.agents = s.agents.filter((a) => a.state !== "gone");
      sceneRef.current?.update({
        agents: s.agents, beams: s.door.beams, nodesOn: s.nodesOn, blind: blindRef.current, selectedId: selRef.current,
        fresnelPair: fresnelRef.current, showFresnel: tabRef.current === "wifi", pairLevel: pairLevels(s.reports),
      });
      if (now - lastUi > 150) {
        lastUi = now;
        setUi({ agents: s.agents.map((a) => ({ id: a.id, name: a.name, state: a.state, checkedIn: a.checkedIn, x: a.x, y: a.y, scans: a.scans })),
          beams: { ...s.door.beams }, door: { entries: s.door.entries, exits: s.door.exits, seq: [...s.door.seq] }, qr: s.qr, reports: s.reports, t: s.t, log: [...s.log] });
      }
    };
    const finishWindow = () => {
      const s = sim.current;
      s.reports = s.win.map(P.linkReport);
      s.row = P.windowFeatures(s.win);
      s.win = P.newWindow();
      const m = modelRef.current, b = baseRef.current;
      if (m && b && s.nodesOn.some(Boolean) && s.row[s.row.length - 1] > 0) {
        const e = P.predictRidge(m, P.detectorInputs(s.row, b));
        s.recent.push(e); if (s.recent.length > 3) s.recent.shift();
        setEstimate({ value: Math.max(0, s.recent.reduce((a, x) => a + x, 0) / s.recent.length), rmse: m.rmse, row: s.row });
      } else setEstimate(null);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const blindRef = useRef(false); blindRef.current = blind;
  const fresnelRef = useRef(2); fresnelRef.current = fresnelPair;
  const tabRef = useRef("scenario"); tabRef.current = tab;

  // ---- scenario + control helpers ----
  const s = sim.current;
  const freeSeat = () => S.SEATS.find((seat) => !s.agents.some((a) => a.seat === seat && a.state !== "leaving")) || null;
  const enter = (scans, delay = 0, extra = {}) => {
    const a = S.makeAgent({ scans, seat: freeSeat(), delay, ...extra });
    if (extra.turnBack) a.turnBack = true;
    s.agents.push(a);
    return a;
  };
  const resetRoom = () => {
    S.resetIds();
    s.agents = []; s.door = S.makeDoorCounter(); s.qr = 0; s.scheduled = []; s.log = []; s.recent = [];
    setSelected(null); setEstimate(null);
  };
  const at = (secFromNow, run) => s.scheduled.push({ at: s.t + secFromNow, run });
  const scenario = {
    "10 enter · 7 scan · 3 don't": () => {
      resetRoom();
      const order = [true, true, false, true, true, false, true, true, false, true];
      order.forEach((scans, i) => enter(scans, 0.5 + i * 2.6));
      log("Scenario: 10 people walk in one by one. 7 scan the door QR, 3 walk straight to a seat.", "info");
    },
    "Tailgating (2 enter together)": () => {
      enter(true, 0.2); enter(false, 0.55);
      log("Scenario: two people walk through the door almost together. Watch the IR log, then the Wi-Fi check.", "info");
    },
    "Half-enter, turn back": () => {
      enter(false, 0.2, { turnBack: true });
      log("Scenario: someone steps into the doorway and turns back. IR must NOT count it.", "info");
    },
    "One person leaves": () => {
      const a = [...s.agents].reverse().find((q) => q.state === "seated" || q.state === "idle");
      if (a) { S.startLeaving(a); log(`#${a.id} ${a.name} gets up and leaves`, "info"); }
    },
    "Everyone leaves": () => {
      s.agents.filter((q) => q.state === "seated" || q.state === "idle").forEach((a, i) => at(i * 1.6, () => S.startLeaving(a)));
      log("Scenario: everyone leaves one by one.", "info");
    },
    "Ghost booking": () => {
      resetRoom(); s.qr = 1;
      log("Scenario: someone checked in from the app but nobody is in the room. Wi-Fi should flag it.", "info");
    },
  };

  // ---- derived numbers ----
  const actual = ui.agents.filter((a) => a.y > 0.02 && a.state !== "waiting").length;
  const ir = Math.max(0, ui.door.entries - ui.door.exits);
  const wifiOn = nodesOn.filter(Boolean).length >= 2;
  const wifi = estimate && wifiOn ? estimate.value : null;
  const verdicts = S.verdict({ ir, qr: ui.qr, wifi, wifiOn });
  const sel = ui.agents.find((a) => a.id === selected);
  const why = whyLinks(ui.reports, baseline, ui.agents);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "Inter, system-ui, sans-serif" }}>
      <style>{`
        .l3-wrap { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 14px; max-width: 1500px; margin: 0 auto; padding: 0 14px 30px; }
        .l3-canvas { width: 100%; height: min(72vh, 760px); display: block; border-radius: 18px; border: 1px solid rgba(196,181,253,0.14); background: #07060C; touch-action: none; }
        @media (max-width: 1000px) { .l3-wrap { grid-template-columns: 1fr; } .l3-canvas { height: 58vh; } }
        .l3-btn:focus-visible { outline: 2px solid #C4B5FD; outline-offset: 2px; }
        .l3-counts { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 8px; }
        @media (max-width: 560px) { .l3-counts { grid-template-columns: repeat(2, minmax(0,1fr)); } }
      `}</style>

      <header style={{ maxWidth: 1500, margin: "0 auto", padding: "16px 14px 10px", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <a href="/" style={{ color: C.silver, textDecoration: "none", fontFamily: head, fontWeight: 700, fontSize: 20 }}>Ghost<span style={{ color: C.violet }}>Slot</span></a>
            <h1 style={{ fontFamily: head, fontSize: 22, margin: 0 }}>Live Sensing Room</h1>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#0A0812", background: C.warn, borderRadius: 999, padding: "3px 10px" }}>3-D SIMULATION</span>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 13.5, color: C.sub, maxWidth: 820, lineHeight: 1.5 }}>
            One room, three independent ways to know who is inside: an <b style={{ color: C.text }}>IR door counter</b> (direction from the order the two beams break),
            the <b style={{ color: C.text }}>door QR check-in</b>, and <b style={{ color: C.text }}>Wi-Fi sensing</b> from 4 ESP32-S3 boards (12 links). Each one catches what the others miss.
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <a href="/lab" className="l3-btn" style={{ ...btn(), textDecoration: "none", display: "inline-flex", alignItems: "center" }}>2-D lab</a>
          <a href="/" className="l3-btn" style={{ ...btn(), textDecoration: "none", display: "inline-flex", alignItems: "center" }}>← App</a>
        </div>
      </header>

      <div className="l3-wrap">
        {/* -------- 3-D view + counters -------- */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div style={{ position: "relative" }}>
            <canvas ref={canvasRef} className="l3-canvas" aria-label="3-D room. Drag to rotate, scroll or pinch to zoom, click a person to select them, click the floor to send them there." />
            {train && (
              <div role="status" style={{ position: "absolute", left: 14, right: 14, top: 14, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px", fontSize: 13 }}>
                {train.msg}
                <div style={{ height: 6, borderRadius: 3, background: "rgba(196,181,253,0.1)", marginTop: 6, overflow: "hidden" }}><div style={{ height: 6, width: `${train.pct}%`, background: C.violet }} /></div>
              </div>
            )}
            {blind && <div style={{ position: "absolute", left: 14, bottom: 14, background: "rgba(245,181,68,0.95)", color: "#0A0812", borderRadius: 10, padding: "6px 10px", fontSize: 13, fontWeight: 700 }}>Blind mode: people hidden. Only Wi-Fi is "watching".</div>}
            <div style={{ position: "absolute", right: 12, top: 12, display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {[["iso", "3-D"], ["top", "Top"], ["door", "Door"], ["corner", "Corner"]].map(([k, l]) => (
                <button key={k} className="l3-btn" style={{ ...btn(), background: "rgba(18,15,30,0.85)" }} onClick={() => sceneRef.current?.view(k)}>{l}</button>
              ))}
            </div>
          </div>

          <div className="l3-counts">
            <Count label="Actually inside" value={actual} note="the truth (hidden from the system)" color={C.text} />
            <Count label="IR door counter" value={ir} note={`${ui.door.entries} in · ${ui.door.exits} out`} color="#FF8B8B" />
            <Count label="QR check-ins" value={ui.qr} note="scanned the door QR" color={C.good} />
            <Count label="Wi-Fi estimate" value={wifi == null ? "—" : `≈${Math.round(wifi)}`} note={wifi == null ? (wifiOn ? "warming up…" : "boards off") : `likely ${Math.max(0, Math.round(wifi - (estimate?.rmse || 1)))}–${Math.round(wifi + (estimate?.rmse || 1))}`} color={C.silver} />
          </div>

          <Panel title="What the system concludes" sub="Built only from the three signals above, never from the truth.">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {verdicts.length === 0 && <div style={{ fontSize: 14, color: C.sub }}>Room empty. Start a scenario on the right.</div>}
              {verdicts.map((v, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14.5, lineHeight: 1.45, color: C.text }}>
                  <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: TONE[v.tone], marginTop: 6, flexShrink: 0 }} />{v.text}
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="IR door counter: how it knows IN from OUT" sub="Beam A is outside, beam B inside. Count only when the full sequence completes.">
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
              <Beam label="A (outside)" cut={ui.beams.a} />
              <Beam label="B (inside)" cut={ui.beams.b} />
              <span style={{ fontFamily: mono, fontSize: 13, color: C.sub }}>now: {ui.door.seq?.length ? ui.door.seq.map((x) => ["", "A", "B", "A+B"][x]).join(" → ") : "door clear"}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13.5, lineHeight: 1.5 }}>
              <div style={{ background: "rgba(61,220,151,0.07)", border: "1px solid rgba(61,220,151,0.3)", borderRadius: 10, padding: 8 }}><b>ENTRY +1</b><br /><span style={{ fontFamily: mono, fontSize: 12.5 }}>A → A+B → B → clear</span></div>
              <div style={{ background: "rgba(255,107,107,0.07)", border: "1px solid rgba(255,107,107,0.3)", borderRadius: 10, padding: 8 }}><b>EXIT −1</b><br /><span style={{ fontFamily: mono, fontSize: 12.5 }}>B → A+B → A → clear</span></div>
            </div>
            <div style={{ fontSize: 12.5, color: C.sub, marginTop: 8, lineHeight: 1.5 }}>Anything else (a half step in and back, a hand waved through) is ignored. A beam blocked over 4 s (someone standing in the door) resets. Two people walking through glued together can count as one: that is the case Wi-Fi catches.</div>
          </Panel>
        </div>

        {/* -------- right column: controls, why-Wi-Fi, log -------- */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div role="tablist" style={{ display: "flex", gap: 6 }}>
            {[["scenario", "Scenarios"], ["control", "Control"], ["wifi", "Why Wi-Fi?"]].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} className="l3-btn" style={{ ...btn(tab === k), flex: 1 }} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>

          {tab === "scenario" && (
            <Panel title="Scenarios" sub="Each one replays a judge's question.">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {Object.entries(scenario).map(([name, run], i) => (
                  <button key={name} className="l3-btn" style={i === 0 ? { ...primary, textAlign: "left" } : { ...btn(), textAlign: "left" }} onClick={run} disabled={!!train && i === 0}>{name}</button>
                ))}
                <button className="l3-btn" style={{ ...btn(false, "rgba(255,107,107,0.4)"), textAlign: "left" }} onClick={resetRoom}>Reset room</button>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: C.sub }}>Speed:</span>
                {[1, 2, 4].map((v) => <button key={v} className="l3-btn" style={btn(speed === v)} onClick={() => setSpeed(v)}>{v}×</button>)}
              </div>
            </Panel>
          )}

          {tab === "control" && (
            <Panel title="You control the people" sub="Click a person in 3-D to select them, then click the floor to send them there.">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="l3-btn" style={btn()} onClick={() => { const a = enter(true, 0.1); setSelected(a.id); }}>+ Enter &amp; scan QR</button>
                <button className="l3-btn" style={btn()} onClick={() => { const a = enter(false, 0.1); setSelected(a.id); }}>+ Enter without scanning</button>
              </div>
              {sel ? (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>#{sel.id} {sel.name} <span style={{ color: sel.checkedIn ? C.good : C.warn, fontWeight: 500 }}>· {sel.checkedIn ? "checked in" : "not checked in"} · {sel.state}</span></div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    <button className="l3-btn" style={btn()} onClick={() => { const a = s.agents.find((q) => q.id === sel.id); if (a) { S.startLeaving(a); log(`#${a.id} leaves`); } }}>Walk out</button>
                    <button className="l3-btn" style={btn()} onClick={() => { const a = s.agents.find((q) => q.id === sel.id); if (a) S.moveAgentTo(a, 3, 1.2); }}>Stand near door</button>
                    <button className="l3-btn" style={btn()} onClick={() => { const a = s.agents.find((q) => q.id === sel.id); if (a) S.moveAgentTo(a, 3, 3); }}>Go to centre (on the 1→4 / 2→3 links)</button>
                    <button className="l3-btn" style={btn()} onClick={() => setSelected(null)}>Deselect</button>
                  </div>
                </div>
              ) : <div style={{ fontSize: 13, color: C.sub, marginTop: 10 }}>No one selected.</div>}
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 13, color: C.sub, marginBottom: 6 }}>ESP32-S3 boards</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {P.NODES.map((n, i) => (
                    <button key={n.id} className="l3-btn" aria-pressed={nodesOn[i]} style={btn(nodesOn[i], nodesOn[i] ? undefined : "rgba(255,107,107,0.5)")} onClick={() => setNodesOn((o) => o.map((v, j) => (j === i ? !v : v)))}>S3·{n.id} {nodesOn[i] ? "ON" : "OFF"}</button>
                  ))}
                </div>
              </div>
            </Panel>
          )}

          {tab === "wifi" && (
            <Panel title="How do we know Wi-Fi detected them?" sub="Three checks you can run right now.">
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.55, color: C.text, display: "flex", flexDirection: "column", gap: 8 }}>
                <li><b>Blind mode.</b> Hide the people. The estimate keeps working, because it only ever uses the 12 links.
                  <div><button className="l3-btn" style={{ ...btn(blind), marginTop: 6 }} onClick={() => setBlind((b) => !b)}>{blind ? "Show people" : "Hide people (blind mode)"}</button></div></li>
                <li><b>Switch the boards off.</b> With the radios off the Wi-Fi estimate disappears. Nothing else feeds it.
                  <div><button className="l3-btn" style={{ ...btn(), marginTop: 6 }} onClick={() => setNodesOn((o) => (o.every(Boolean) ? [false, false, false, false] : [true, true, true, true]))}>{nodesOn.every(Boolean) ? "All boards OFF" : "All boards ON"}</button></div></li>
                <li><b>Follow the links.</b> A body inside a link's Fresnel zone (the ellipse) disturbs that link most. Pick a link and walk someone into it.
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                    {P.PAIR_NAMES.map((n, i) => <button key={n} className="l3-btn" style={{ ...btn(fresnelPair === i), padding: "6px 8px" }} onClick={() => setFresnelPair(i)}>{n}</button>)}
                  </div></li>
              </ol>
              <div style={{ marginTop: 12, fontSize: 13, color: C.sub }}>Most disturbed links right now (vs the empty room):</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 6 }}>
                {why.length === 0 && <div style={{ fontSize: 13, color: C.muted }}>Waiting for the next 2 s window…</div>}
                {why.map((w) => (
                  <div key={w.pair} style={{ display: "grid", gridTemplateColumns: "48px 1fr 54px", gap: 8, alignItems: "center", fontSize: 13 }}>
                    <span style={{ fontFamily: mono }}>{w.pair}</span>
                    <span style={{ height: 8, borderRadius: 4, background: "rgba(196,181,253,0.08)", overflow: "hidden" }}><span style={{ display: "block", height: 8, width: `${Math.min(100, w.level * 100)}%`, background: C.silver }} /></span>
                    <span style={{ fontFamily: mono, textAlign: "right" }}>{w.motion.toFixed(0)}</span>
                    <span style={{ gridColumn: "1 / -1", fontSize: 12, color: C.muted, marginTop: -2 }}>{w.who.length ? `in its zone: ${w.who.map((id) => `#${id}`).join(", ")}` : "nobody in its zone: reflections from people elsewhere"}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Panel title="Event log" sub="IR door counter, QR scans and scenario steps.">
            <div aria-live="polite" style={{ background: "#07060C", borderRadius: 10, padding: 10, height: 260, overflow: "auto", fontFamily: mono, fontSize: 12, lineHeight: 1.55, display: "flex", flexDirection: "column-reverse" }}>
              <div>
                {ui.log.length === 0 && <div style={{ color: C.muted }}>Nothing yet. Pick a scenario.</div>}
                {ui.log.map((e, i) => (
                  <div key={i} style={{ color: e.kind === "in" ? C.good : e.kind === "out" ? "#FF8B8B" : e.kind === "skip" ? C.warn : e.kind === "qr" ? C.silver : "#CFC7EC" }}>
                    <span style={{ color: C.muted }}>{e.t.toFixed(1).padStart(5)}s </span>{e.text}
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>
      </div>
      <footer style={{ maxWidth: 1500, margin: "0 auto", padding: "0 14px 30px", fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
        Simulation, not a measurement. Wi-Fi: 2.4 GHz multipath model (direct path, wall reflections, one scattered path per person, Fresnel-zone blocking, noise, AGC), processed like GhostSlot firmware v2 and
        read by a detector trained on simulated recordings. IR: two beams 18 cm apart at 1 m height, counted by sequence. Live hardware results are on the Demo Room card in the app.
      </footer>
    </div>
  );
}

function Count({ label, value, note, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 12, minWidth: 0 }}>
      <div style={{ fontSize: 12.5, color: C.sub }}>{label}</div>
      <div style={{ fontFamily: head, fontSize: 34, fontWeight: 700, color, lineHeight: 1.15 }}>{value}</div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{note}</div>
    </div>
  );
}
function Beam({ label, cut }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, padding: "5px 10px", borderRadius: 999, border: `1px solid ${cut ? "rgba(255,107,107,0.2)" : "rgba(255,107,107,0.6)"}`, background: cut ? "rgba(255,107,107,0.05)" : "rgba(255,45,45,0.12)" }}>
      <span aria-hidden style={{ width: 22, height: 3, borderRadius: 2, background: cut ? "#552222" : "#ff2d2d", boxShadow: cut ? "none" : "0 0 8px #ff2d2d" }} />
      {label}: <b>{cut ? "CUT" : "clear"}</b>
    </span>
  );
}

// Pair motion levels (0..1) for the 3-D link glow.
function pairLevels(reports) {
  if (!reports) return new Array(6).fill(0);
  return P.PAIRS.map(([a, b]) => {
    const v = P.LINKS.map((l, i) => ((l[0] === a && l[1] === b) || (l[0] === b && l[1] === a)) && reports[i] ? reports[i].motion : null).filter((x) => x != null);
    if (!v.length) return 0;
    const m = v.reduce((x, y) => x + y, 0) / v.length;
    return Math.max(0, Math.min(1, (m - 50) / 90));
  });
}
// Top disturbed pairs and who stands in their first Fresnel zone.
function whyLinks(reports, baseline, agents) {
  if (!reports) return [];
  const levels = pairLevels(reports);
  return P.PAIRS.map(([a, b], i) => {
    const A = P.NODES[a - 1], B = P.NODES[b - 1];
    const L = Math.hypot(B.x - A.x, B.y - A.y);
    const who = agents.filter((p) => p.y > 0.02 && p.state !== "waiting").filter((p) => {
      const vx = B.x - A.x, vy = B.y - A.y;
      const t = ((p.x - A.x) * vx + (p.y - A.y) * vy) / (L * L);
      if (t <= 0 || t >= 1) return false;
      const d = Math.hypot(p.x - (A.x + t * vx), p.y - (A.y + t * vy));
      return d < 1.6 * Math.sqrt((P.LAMBDA * L * t * L * (1 - t)) / L) + 0.18;
    }).map((p) => p.id);
    const v = P.LINKS.map((l, j) => ((l[0] === a && l[1] === b) || (l[0] === b && l[1] === a)) && reports[j] ? reports[j].motion : null).filter((x) => x != null);
    return { pair: P.PAIR_NAMES[i], level: levels[i], motion: v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0, who };
  }).filter((w) => w.motion > 0).sort((x, y) => y.level - x.level).slice(0, 3);
}
