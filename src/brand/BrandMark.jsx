import React from "react";

// ─────────────────────────────────────────────────────────────────────────────
// GhostSlot logo: ONE place to change it. The official mark (ghost with the
// calendar + location badge) lives in public/brand/. Every screen (login,
// sidebar, top bar, CampusAI) uses these two components.
// ─────────────────────────────────────────────────────────────────────────────
export const LOGO_SRC = "/brand/logo-192.png";

// Brand colours taken from the logo: lavender-white strokes, electric violet.
export const BRAND = {
  violet: "#8B5CF6",
  lavender: "#C4B5FD",
  ink: "#F4F1FF",
  glow: "rgba(139,92,246,0.45)",
};

export function BrandMark({ size = 34, glow = false }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: Math.round(size * 0.28), flexShrink: 0, overflow: "hidden",
      background: "#000", border: "1px solid rgba(196,181,253,0.16)",
      boxShadow: glow ? `0 0 56px ${BRAND.glow}, 0 0 0 1px rgba(139,92,246,0.25)` : `0 0 18px rgba(139,92,246,0.22)`,
    }}>
      <img src={LOGO_SRC} alt="GhostSlot logo" width={size} height={size} draggable={false}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
    </div>
  );
}

export function Wordmark({ size = 20 }) {
  return (
    <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: size, letterSpacing: "-0.02em", color: BRAND.ink }}>
      Ghost<span style={{ color: "#A78BFA", textShadow: `0 0 18px ${BRAND.glow}` }}>Slot</span>
    </div>
  );
}
