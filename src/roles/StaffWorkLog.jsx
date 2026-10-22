// Facilities profile card: this staff member's own work in the last 30 days
// (from /api/twin/me, which only ever counts their own rows).
import React, { useEffect, useState } from "react";
import { ClipboardCheck, CheckCircle2, Eye, ClipboardPen } from "lucide-react";
import { api } from "../api";

const box = { flex: "1 1 120px", background: "#120F1E", borderRadius: 14, padding: 12, border: "1px solid rgba(196,181,253,0.07)" };
const big = { fontSize: 20, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" };
const small = { fontSize: 11, color: "#A39CC4", display: "flex", alignItems: "center", gap: 4 };

export function StaffWorkLog({ department }) {
  const [me, setMe] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api("/twin/me").then(setMe).catch(setErr); }, []);
  const last = me?.lastActionAt
    ? new Date(me.lastActionAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) + " IST"
    : "nothing yet";
  return (
    <div style={{ background: "linear-gradient(180deg, #1E1936, #100D1B)", borderRadius: 18, padding: 16, border: "1px solid rgba(196,181,253,0.07)", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 11.5, color: "#A39CC4", fontFamily: "'JetBrains Mono', monospace", display: "flex", gap: 6, alignItems: "center" }}><ClipboardCheck size={13} /> YOUR WORK · LAST 30 DAYS</div>
        {department && <div style={{ fontSize: 11.5, color: "#CFC7EC" }}>{department} team</div>}
      </div>
      {err && <div style={{ fontSize: 12, color: "#A39CC4" }}>Couldn't load your work log ({err.message}).</div>}
      {!err && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={box}><div style={{ ...big, color: "#3DDC97" }}>{me ? me.alertsResolved : "…"}</div><div style={small}><CheckCircle2 size={11} /> alerts resolved</div></div>
          <div style={box}><div style={big}>{me ? me.alertsAcknowledged : "…"}</div><div style={small}><Eye size={11} /> acknowledged, in progress</div></div>
          <div style={box}><div style={big}>{me ? me.readingsLogged : "…"}</div><div style={small}><ClipboardPen size={11} /> readings logged{me ? ` (${me.energyReadings} ⚡ · ${me.waterReadings} 💧)` : ""}</div></div>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "#A39CC4" }}>Last action: {last}</div>
    </div>
  );
}
