// Facilities-only map tools:
//  1. Door QR codes: one sticker per room. Scanning it opens GhostSlot with
//     "you're here" already set, which is more precise than GPS indoors.
//  2. GPS calibration: stand at a known spot, save its GPS fix. With three
//     spread-out spots the phone's GPS can place people on the campus map.
import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { QrCode, Printer, LocateFixed, Loader2, Copy, Trash2, Check } from "lucide-react";
import { doorLink, readGps, saveAnchor, loadAnchors, clearLocalAnchors, fitGeo } from "./location";

const card = { background: "#120F1E", border: "1px solid rgba(196,181,253,0.14)", borderRadius: 16, padding: 14, display: "flex", flexDirection: "column", gap: 10 };
const btn = (primary) => ({
  background: primary ? "linear-gradient(180deg, #C4B5FD, #8B5CF6)" : "rgba(196,181,253,0.06)", color: primary ? "#0A0812" : "#E9E3FF",
  border: primary ? "none" : "1px solid rgba(196,181,253,0.16)", borderRadius: 10, padding: "8px 12px", fontWeight: 700, fontSize: 12.5,
  cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5,
});

export function DoorQrCodes({ rooms }) {
  const [codes, setCodes] = useState([]);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    const origin = window.location.origin;
    Promise.all(rooms.map(async (r) => ({ id: r.id, name: r.name, block: r.block, url: doorLink(origin, r.id),
      svg: await QRCode.toString(doorLink(origin, r.id), { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0A0812", light: "#FFFFFF" } }) })))
      .then((c) => { if (alive) setCodes(c); })
      .catch(() => { if (alive) setErr("Couldn't make the QR codes. Reload and try again."); });
    return () => { alive = false; };
  }, [rooms]);

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 15, display: "flex", gap: 6, alignItems: "center" }}><QrCode size={15} color="#C4B5FD" /> Door QR codes</div>
          <div style={{ fontSize: 11.5, color: "#A39CC4" }}>Stick one on each door. Scanning it checks the person into that room and shows the closest free spots from there.</div>
        </div>
        <button onClick={() => window.print()} style={btn(true)} disabled={!codes.length}><Printer size={13} /> Print</button>
      </div>
      {err && <div style={{ fontSize: 12, color: "#FF8B8B" }}>{err}</div>}
      <div className="gs-qr-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
        {codes.map((c) => (
          <div key={c.id} className="gs-qr-card" style={{ background: "#FFFFFF", color: "#0A0812", borderRadius: 12, padding: 10, textAlign: "center" }}>
            {/* SVG made by the qrcode library from our own URL, not user input. */}
            <div style={{ width: "100%", aspectRatio: "1" }} dangerouslySetInnerHTML={{ __html: c.svg }} />
            <div style={{ fontWeight: 800, fontSize: 12.5, marginTop: 4 }}>{c.name}</div>
            <div style={{ fontSize: 10, opacity: 0.7 }}>Scan · GhostSlot</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GpsCalibration({ places, onChanged }) {
  const [placeId, setPlaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [anchors, setAnchors] = useState(() => loadAnchors());
  const [copied, setCopied] = useState(false);
  const lock = useRef(false);
  const ready = !!fitGeo(anchors);

  async function capture() {
    const p = places.find((x) => x.id === placeId);
    if (!p) { setMsg("Pick the spot you're standing at first."); return; }
    if (lock.current) return;
    lock.current = true; setBusy(true); setMsg(null);
    try {
      const fix = await readGps();
      if (fix.accuracyM > 60) setMsg(`Saved, but GPS was rough (±${fix.accuracyM} m). Outdoors in the open gives the best anchors.`);
      const next = saveAnchor({ label: p.label, lat: fix.lat, lng: fix.lng, x: Math.round(p.x), y: Math.round(p.y) });
      setAnchors(next); onChanged && onChanged();
      if (fix.accuracyM <= 60) setMsg(`Saved ${p.label} (±${fix.accuracyM} m).`);
    } catch (e) {
      setMsg(e.message);
    } finally { lock.current = false; setBusy(false); }
  }
  async function copyAll() {
    try { await navigator.clipboard.writeText(JSON.stringify(anchors, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { setMsg("Couldn't copy. Select the list below and copy it by hand."); }
  }

  return (
    <div style={card}>
      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 15, display: "flex", gap: 6, alignItems: "center" }}><LocateFixed size={15} color="#C4B5FD" /> GPS calibration</div>
      <div style={{ fontSize: 11.5, color: "#A39CC4", lineHeight: 1.5 }}>
        Stand at a spot, pick it, tap <b>Save my GPS here</b>. Three spots far apart (e.g. Main Gate side, Sports Complex, A2 Block) let everyone's GPS land on this map.
        {" "}{ready ? <b style={{ color: "#3DDC97" }}>GPS is live on this phone.</b> : <b style={{ color: "#F5B544" }}>{anchors.length}/3 spots saved.</b>}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select value={placeId} onChange={(e) => setPlaceId(e.target.value)} aria-label="Spot you're standing at"
          style={{ flex: "1 1 200px", background: "#07060C", color: "#F4F1FF", border: "1px solid rgba(196,181,253,0.16)", borderRadius: 10, padding: "8px 10px", fontSize: 12.5 }}>
          <option value="">I'm standing at…</option>
          {places.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <button onClick={capture} disabled={busy} style={{ ...btn(true), opacity: busy ? 0.7 : 1 }}>{busy ? <Loader2 size={13} className="gs-spin" /> : <LocateFixed size={13} />} Save my GPS here</button>
      </div>
      {msg && <div role="status" style={{ fontSize: 11.5, color: "#F5B544" }}>{msg}</div>}
      {anchors.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={copyAll} style={btn()}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy for campus.js"}</button>
            <button onClick={() => { clearLocalAnchors(); setAnchors(loadAnchors()); onChanged && onChanged(); }} style={btn()}><Trash2 size={13} /> Clear this phone's spots</button>
          </div>
          <div style={{ fontSize: 11, color: "#857DA8", fontFamily: "'JetBrains Mono', monospace" }}>
            {anchors.map((a) => <div key={a.label}>{a.label}: {a.lat.toFixed(5)}, {a.lng.toFixed(5)}</div>)}
          </div>
          <div style={{ fontSize: 10.5, color: "#857DA8" }}>These spots live on this phone only. Paste them into GEO_ANCHORS in src/campus.js to turn GPS on for everyone.</div>
        </>
      )}
    </div>
  );
}
