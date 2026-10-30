// In-app door QR scanner for check-in. Opens the back camera, reads the room's
// door QR (the same link that's printed on the door) and hands back the room ID.
// Nothing is recorded or uploaded: frames are decoded on this phone and the
// camera is switched off the moment a code is read or the scanner is closed.
import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { X, ScanLine, Loader2 } from "lucide-react";

// Pull the room ID out of a scanned door link (…/?at=<roomId>) or a bare ID.
export function roomFromQr(text, knownRooms) {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 500) return null;
  let id = null;
  try { id = new URL(raw).searchParams.get("at"); } catch { id = raw; }
  return id && knownRooms[id] ? id : null;
}

export default function QrScanner({ knownRooms, title = "Scan the door QR", hint, onRoom, onClose, onFallback, fallbackLabel }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [state, setState] = useState("starting"); // starting | scanning | error
  const [msg, setMsg] = useState("");
  const [wrong, setWrong] = useState("");
  const doneRef = useRef(false);

  useEffect(() => {
    let stream = null;
    let raf = 0;
    let last = 0;
    let alive = true;
    const detector = typeof window !== "undefined" && "BarcodeDetector" in window
      ? (() => { try { return new window.BarcodeDetector({ formats: ["qr_code"] }); } catch { return null; } })()
      : null;

    const stop = () => {
      cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
    };

    const handle = (text) => {
      if (doneRef.current || !text) return;
      const id = roomFromQr(text, knownRooms);
      if (id) { doneRef.current = true; stop(); onRoom(id); }
      else setWrong("That's not a GhostSlot room QR. Point at the sticker on the room's door.");
    };

    const tick = async (t) => {
      if (!alive || doneRef.current) return;
      raf = requestAnimationFrame(tick);
      if (t - last < 180) return; // ~5 reads a second is plenty
      last = t;
      const v = videoRef.current;
      if (!v || v.readyState < 2 || !v.videoWidth) return;
      try {
        if (detector) {
          const codes = await detector.detect(v);
          if (codes[0]) handle(codes[0].rawValue);
          return;
        }
        const c = canvasRef.current;
        const scale = Math.min(1, 640 / v.videoWidth);
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const img = ctx.getImageData(0, 0, c.width, c.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        if (code) handle(code.data);
      } catch { /* a bad frame; try the next one */ }
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState("error"); setMsg("This browser can't open the camera. Use your phone's camera app to scan the door QR instead.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (!alive) { stop(); return; }
        const v = videoRef.current;
        v.srcObject = stream;
        await v.play().catch(() => {});
        setState("scanning");
        raf = requestAnimationFrame(tick);
      } catch (e) {
        setState("error");
        setMsg(e && e.name === "NotAllowedError"
          ? "Camera permission was blocked. Allow the camera for this site in your browser settings, or use your phone's camera app on the door QR."
          : "Couldn't open the camera. Close other apps using it and try again.");
      }
    })();

    return () => { alive = false; stop(); };
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(7,6,12,0.88)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "min(380px, 100%)", background: "linear-gradient(180deg, #1B1732, #100D1B)", border: "1px solid rgba(196,181,253,0.16)", borderRadius: 22, padding: 16, display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 30px 80px rgba(0,0,0,.6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div>
            <div style={{ fontSize: 10.5, color: "#A39CC4", fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>CHECK IN</div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 18, color: "#F4F1FF" }}>{title}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "rgba(196,181,253,0.06)", border: "1px solid rgba(196,181,253,0.14)", borderRadius: 10, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X size={15} color="#E9E3FF" />
          </button>
        </div>

        <div style={{ position: "relative", width: "100%", aspectRatio: "1", borderRadius: 16, overflow: "hidden", background: "#07060C", border: "1px solid rgba(196,181,253,0.12)" }}>
          <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", display: state === "error" ? "none" : "block" }} />
          {state !== "error" && (
            <div aria-hidden style={{ position: "absolute", inset: "16%", border: "2px solid rgba(196,181,253,0.85)", borderRadius: 18, boxShadow: "0 0 0 999px rgba(7,6,12,0.35)" }}>
              <div className="gs-scanline" style={{ position: "absolute", left: 8, right: 8, height: 2, background: "linear-gradient(90deg, transparent, #C4B5FD, transparent)" }} />
            </div>
          )}
          {state === "starting" && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#CFC7EC", fontSize: 12.5 }}>
              <Loader2 size={15} className="gs-spin" /> Opening camera…
            </div>
          )}
          {state === "error" && (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 20, textAlign: "center", color: "#CFC7EC", fontSize: 12.5, lineHeight: 1.5 }}>
              <ScanLine size={26} color="#857DA8" />{msg}
            </div>
          )}
        </div>
        <canvas ref={canvasRef} style={{ display: "none" }} />

        <div style={{ fontSize: 12, color: wrong ? "#F5B544" : "#A39CC4", lineHeight: 1.5, minHeight: 18 }}>
          {wrong || hint || "Point at the QR sticker on the room's door. The camera turns off as soon as it reads it. Nothing is recorded."}
        </div>
        {onFallback && (
          <button onClick={onFallback} style={{ background: "transparent", border: "1px solid rgba(196,181,253,0.16)", color: "#D2C8F5", borderRadius: 10, padding: "8px 10px", fontSize: 12, cursor: "pointer" }}>
            {fallbackLabel || "Can't scan? Check in without the QR"}
          </button>
        )}
      </div>
    </div>
  );
}
