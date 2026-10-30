// A room's check-in QR, shown big on screen (same link as the printed door
// sticker). Handy for demos: point a phone at the laptop and you're checked in.
import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { X, Copy, Check } from "lucide-react";
import { doorLink } from "./location";

export default function CheckInQr({ roomId, roomName, onClose }) {
  const [svg, setSvg] = useState("");
  const [err, setErr] = useState(false);
  const [copied, setCopied] = useState(false);
  const closeRef = useRef(null);
  const url = doorLink(window.location.origin, roomId);

  useEffect(() => {
    let alive = true;
    QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0A0812", light: "#FFFFFF" } })
      .then((s) => { if (alive) setSvg(s); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [url]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={`Check-in QR for ${roomName}`} onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(7,6,12,0.82)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "min(360px, 100%)", background: "linear-gradient(180deg, #1B1732, #100D1B)", border: "1px solid rgba(196,181,253,0.16)", borderRadius: 22, padding: 18, display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 30px 80px rgba(0,0,0,.6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div>
            <div style={{ fontSize: 10.5, color: "#A39CC4", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>DOOR CHECK-IN</div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 19, color: "#F4F1FF" }}>{roomName}</div>
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Close" style={{ background: "rgba(196,181,253,0.06)", border: "1px solid rgba(196,181,253,0.14)", borderRadius: 10, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X size={15} color="#E9E3FF" />
          </button>
        </div>
        <div style={{ background: "#FFFFFF", borderRadius: 16, padding: 14 }}>
          {err ? <div style={{ color: "#B42318", fontSize: 13, textAlign: "center", padding: 30 }}>Couldn't make the QR. Reload and try again.</div>
            /* SVG made by the qrcode library from our own URL, not user input. */
            : <div style={{ width: "100%", aspectRatio: "1" }} dangerouslySetInnerHTML={{ __html: svg }} />}
        </div>
        <div style={{ fontSize: 12.5, color: "#CFC7EC", lineHeight: 1.5 }}>
          Scan with your phone camera to check in here. Booked this room? Scanning within the grace time keeps it yours.
        </div>
        <button onClick={copy} style={{ background: "rgba(196,181,253,0.06)", border: "1px solid rgba(196,181,253,0.14)", color: "#D2C8F5", borderRadius: 10, padding: "8px 10px", fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace", display: "flex", alignItems: "center", gap: 6, cursor: "pointer", overflow: "hidden" }}>
          {copied ? <Check size={13} color="#3DDC97" /> : <Copy size={13} />}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{copied ? "Link copied" : url.replace(/^https?:\/\//, "")}</span>
        </button>
      </div>
    </div>
  );
}
