import React from "react";
import { Ghost } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// GhostSlot logo — ONE place to change it.
// When the official logo is ready: put it at public/brand/logo.png (square,
// at least 256×256) and set LOGO_SRC = "/brand/logo.png". Every screen
// (login, sidebar, top bar, CampusAI) picks it up automatically.
// ─────────────────────────────────────────────────────────────────────────────
export const LOGO_SRC = null;

export function BrandMark({ size = 34, glow = false }) {
  const radius = Math.round(size * 0.3);
  const frame = {
    width: size, height: size, borderRadius: radius, flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
    boxShadow: glow ? "0 0 48px rgba(200,205,220,0.18), 0 1px 0 rgba(255,255,255,.5) inset" : "0 1px 0 rgba(255,255,255,.5) inset",
  };
  if (LOGO_SRC) {
    return (
      <div style={{ ...frame, background: "#000", border: "1px solid rgba(255,255,255,0.09)" }}>
        <img src={LOGO_SRC} alt="GhostSlot logo" width={size} height={size} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      </div>
    );
  }
  return (
    <div role="img" aria-label="GhostSlot logo" style={{ ...frame, background: "linear-gradient(180deg, #ECEEF2, #B9BEC9)" }}>
      <Ghost size={Math.round(size * 0.56)} color="#08090B" strokeWidth={2.2} />
    </div>
  );
}

export function Wordmark({ size = 20 }) {
  return (
    <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: size, letterSpacing: "-0.02em", color: "#F4F5F7" }}>
      Ghost<span style={{ color: "#9EA3AE" }}>Slot</span>
    </div>
  );
}
