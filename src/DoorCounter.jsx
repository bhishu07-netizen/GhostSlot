// Live IR door counter on the Demo Room card, checked against the QR
// check-ins and the Wi-Fi people count. Counts only, no personal data.
import React, { useEffect, useState } from "react";
import { verdict } from "./lab3d/sim";

export function useDoorStatus(intervalMs = 1500) {
  const [door, setDoor] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/door/status");
        if (!res.ok) throw new Error(String(res.status));
        const d = await res.json();
        if (!cancelled) setDoor(d);
      } catch { if (!cancelled) setDoor(null); }
    };
    poll();
    const t = setInterval(poll, intervalMs);
    return () => { cancelled = true; clearInterval(t); };
  }, [intervalMs]);
  return door;
}

const TONE = { good: "#3DDC97", warn: "#F5B544", bad: "#FF6B6B", muted: "#857DA8" };

function Beam({ label, cut, online }) {
  const on = online && !cut;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#CFC7EC" }}>
      <span aria-hidden style={{ width: 22, height: 3, borderRadius: 2, background: on ? "#ff2d2d" : "#4a1c1c", boxShadow: on ? "0 0 8px #ff2d2d" : "none" }} />
      {label}: <b style={{ color: cut ? "#F5B544" : "#F4F1FF" }}>{!online ? "—" : cut ? "CUT" : "clear"}</b>
    </span>
  );
}

// wifi: the mesh prediction ({label, estimate}) or null; checkedIn: QR count for this room.
export function DoorCounter({ door, mesh, checkedIn = 0 }) {
  if (!door) return null;
  const online = door.online;
  const pred = mesh?.prediction;
  const wifiOn = !!pred && mesh?.mode !== "simulation";
  const wifi = wifiOn ? (typeof pred.estimate === "number" ? pred.estimate : /^\d+$/.test(pred.label) ? Number(pred.label) : null) : null;
  const notes = online || door.entries + door.exits > 0 ? verdict({ ir: door.inside, qr: checkedIn, wifi, wifiOn: wifi != null }) : [];
  return (
    <div style={{ background: "rgba(196,181,253,0.03)", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: "#A39CC4", fontWeight: 700 }}>Door counter (IR)</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: online ? "#3DDC97" : "#857DA8" }}>{online ? "● live" : "○ board offline"}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 30, fontWeight: 700, color: "#F4F1FF" }}>{door.inside}</span>
        <span style={{ fontSize: 13, color: "#CFC7EC" }}>inside · {door.entries} in · {door.exits} out</span>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <Beam label="Beam A (outside)" cut={door.beams?.a} online={online} />
        <Beam label="Beam B (inside)" cut={door.beams?.b} online={online} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 6 }}>
        {[["IR door", door.inside, "#FF8B8B"], ["QR check-ins", checkedIn, "#3DDC97"], ["Wi-Fi", wifi == null ? "—" : Math.round(wifi), "#C4B5FD"]].map(([l, v, c]) => (
          <div key={l} style={{ background: "rgba(7,6,12,0.5)", borderRadius: 10, padding: "6px 8px" }}>
            <div style={{ fontSize: 10.5, color: "#A39CC4" }}>{l}</div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, color: c }}>{v}</div>
          </div>
        ))}
      </div>
      {notes.slice(0, 2).map((n, i) => (
        <div key={i} style={{ display: "flex", gap: 7, fontSize: 12.5, lineHeight: 1.4, color: "#F4F1FF" }}>
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 99, background: TONE[n.tone], marginTop: 5, flexShrink: 0 }} />{n.text}
        </div>
      ))}
      <div style={{ fontSize: 11, color: "#857DA8", lineHeight: 1.4 }}>Beam A then B = in, B then A = out. Counts only, no cameras, no names.</div>
    </div>
  );
}
