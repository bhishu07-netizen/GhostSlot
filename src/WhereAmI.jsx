// "Where are you?" bar: GPS, pick your block, or the QR on a room door.
// Every button is guarded, so mashing "Use my location" fires one GPS
// request, not five, and every failure ends in a clear next step.
import React, { useMemo, useRef, useState } from "react";
import { LocateFixed, MapPin, X, Loader2, QrCode, ChevronDown } from "lucide-react";
import { readGps, fitGeo, loadAnchors, onCampus, nearestPlace } from "./location";

const C = { card: "#120F1E", line: "rgba(196,181,253,0.14)", text: "#F4F1FF", sub: "#A39CC4", muted: "#857DA8", violet: "#8B5CF6", lav: "#C4B5FD", warn: "#F5B544" };

function ago(at) {
  const m = Math.round((Date.now() - at) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}
const SOURCE = { gps: "GPS", pick: "you picked", qr: "door QR", map: "map tap" };

export default function WhereAmI({ places, location, onSet, onClear, compact = false }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [picking, setPicking] = useState(false);
  const lock = useRef(false);
  const groups = useMemo(() => {
    const g = {};
    for (const p of places) (g[p.group] ||= []).push(p);
    return Object.entries(g);
  }, [places]);

  async function useGps() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMsg(null);
    try {
      const geo = fitGeo(loadAnchors());
      if (!geo) {
        setMsg({ tone: "warn", text: "GPS isn't calibrated for this campus map yet. Pick where you are below (one tap)." });
        setPicking(true);
        return;
      }
      const fix = await readGps();
      const pt = geo.toMap(fix.lat, fix.lng);
      if (!onCampus(pt)) {
        setMsg({ tone: "warn", text: "Your GPS says you're off campus. Pick where you'll start from instead." });
        setPicking(true);
        return;
      }
      const near = nearestPlace(places, pt.x, pt.y);
      onSet({ x: pt.x, y: pt.y, label: near ? `near ${near.label}` : "on campus", source: "gps", accuracyM: fix.accuracyM, at: Date.now() });
      if (fix.accuracyM > 80) setMsg({ tone: "warn", text: `GPS is rough here (±${fix.accuracyM} m, normal indoors). If it looks off, pick your block.` });
    } catch (e) {
      setMsg({ tone: "warn", text: e.message || "Couldn't get your location. Pick where you are instead." });
      setPicking(true);
    } finally {
      lock.current = false; setBusy(false);
    }
  }

  function pick(id) {
    const p = places.find((x) => x.id === id);
    if (!p) return;
    onSet({ x: p.x, y: p.y, label: p.label, placeId: p.id, source: "pick", at: Date.now() });
    setPicking(false); setMsg(null);
  }

  return (
    <div style={{ background: `linear-gradient(135deg, rgba(139,92,246,0.14), rgba(18,15,30,0.9) 55%)`, border: `1px solid ${location ? "rgba(139,92,246,0.45)" : C.line}`, borderRadius: 16, padding: compact ? 10 : 12, display: "flex", flexDirection: "column", gap: 8 }}>
      {location ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 30, height: 30, borderRadius: 10, background: "rgba(139,92,246,0.22)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 0 16px rgba(139,92,246,0.45)" }}>
            <MapPin size={15} color={C.lav} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>You're {location.label.startsWith("near") ? location.label : `at ${location.label}`}</div>
            <div style={{ fontSize: 11, color: C.muted }}>{SOURCE[location.source] || "set"} · {ago(location.at)} · walking times are from here</div>
          </div>
          <button onClick={() => setPicking((p) => !p)} style={chip()}>Change</button>
          <button onClick={() => { onClear(); setMsg(null); }} aria-label="Clear my location" style={{ ...chip(), padding: 6 }}><X size={13} /></button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 180px", minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Where are you?</div>
            <div style={{ fontSize: 11, color: C.muted }}>Get the closest best room by real walking time.</div>
          </div>
          <button onClick={useGps} disabled={busy} style={{ ...chip(true), opacity: busy ? 0.7 : 1 }}>
            {busy ? <Loader2 size={13} className="gs-spin" /> : <LocateFixed size={13} />} {busy ? "Locating…" : "Use my location"}
          </button>
          <button onClick={() => setPicking((p) => !p)} style={chip()}>Pick place <ChevronDown size={12} /></button>
        </div>
      )}

      {picking && (
        <select autoFocus defaultValue="" onChange={(e) => pick(e.target.value)} aria-label="Pick where you are"
          style={{ width: "100%", background: "#07060C", color: C.text, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 10px", fontSize: 13 }}>
          <option value="" disabled>I'm at…</option>
          {groups.map(([g, ps]) => (
            <optgroup key={g} label={g}>
              {ps.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </optgroup>
          ))}
        </select>
      )}

      {msg && <div role="status" style={{ fontSize: 11.5, color: msg.tone === "warn" ? C.warn : C.sub, lineHeight: 1.45 }}>{msg.text}</div>}
      {!location && !compact && (
        <div style={{ fontSize: 10.5, color: C.muted, display: "flex", alignItems: "center", gap: 5 }}>
          <QrCode size={11} /> Tip: scan the GhostSlot QR on any room door to set your spot instantly.
        </div>
      )}
    </div>
  );
}

function chip(primary = false) {
  return primary
    ? { background: "linear-gradient(180deg, #C4B5FD, #8B5CF6)", color: "#0A0812", border: "none", borderRadius: 10, padding: "8px 12px", fontWeight: 700, fontSize: 12.5, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, boxShadow: "0 0 18px rgba(139,92,246,0.4)", whiteSpace: "nowrap" }
    : { background: "rgba(196,181,253,0.06)", color: "#E9E3FF", border: "1px solid rgba(196,181,253,0.16)", borderRadius: 10, padding: "7px 10px", fontWeight: 600, fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" };
}
