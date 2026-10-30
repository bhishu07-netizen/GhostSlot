// Demo Room people-count radar, driven ONLY by /api/csi/mesh/status.
//
// What is real on this screen:
//   - the count and its confidence come from the trained model on the server
//     (or the simulator, which is always labelled "simulation")
//   - each link line's glow is that link's measured motion
//   - board dots are lit only when that board checked in recently
// What is NOT real: where the people dots sit. They are drawn near the most
// disturbed links so the picture reads naturally, and the screen says so.
import { useEffect, useState } from "react";

const VIOLET = "#A78BFA";
const LAVENDER = "#C4B5FD";
const INK = "#F4F1FF";
const MUTED = "#A39CC4";
const FAINT = "#6A6390";
const AMBER = "#D9B26A";

// Board corners inside the 200x200 room (matches the placement guide).
const CORNERS = { "mesh-1": [24, 24], "mesh-2": [176, 24], "mesh-3": [24, 176], "mesh-4": [176, 176] };

export function useMeshStatus(intervalMs = 2000) {
  const [mesh, setMesh] = useState(null);
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/csi/mesh/status");
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled) setMesh(data);
      } catch {
        if (!cancelled) setMesh(null); // never invent a count when the server is away
      }
    }
    poll();
    const t = setInterval(poll, intervalMs);
    return () => { cancelled = true; clearInterval(t); };
  }, [intervalMs]);
  return mesh;
}

// Merge the two directions of each board pair into one line with a motion value.
function pairLines(links) {
  const pairs = new Map();
  for (const l of links || []) {
    if (!CORNERS[l.from] || !CORNERS[l.to]) continue;
    const key = [l.from, l.to].sort().join("|");
    const p = pairs.get(key) || { a: l.from < l.to ? l.from : l.to, b: l.from < l.to ? l.to : l.from, sum: 0, n: 0 };
    p.sum += l.motion; p.n += 1;
    pairs.set(key, p);
  }
  return [...pairs.values()].map((p) => ({ ...p, motion: p.sum / p.n }));
}

// The 5 zones the zone model can name (only when exactly one person is inside).
// The two diagonals split the room into 4 triangles; the centre is where they cross.
const C = [100, 100];
const ZONE_SHAPES = {
  front: { points: [CORNERS["mesh-1"], CORNERS["mesh-2"], C], anchor: [100, 52] },
  back: { points: [CORNERS["mesh-3"], CORNERS["mesh-4"], C], anchor: [100, 148] },
  left: { points: [CORNERS["mesh-1"], CORNERS["mesh-3"], C], anchor: [52, 100] },
  right: { points: [CORNERS["mesh-2"], CORNERS["mesh-4"], C], anchor: [148, 100] },
  centre: { circle: 26, anchor: C },
};

// Deterministic spots near the busiest links (no randomness, so dots don't jump).
function peopleSpots(count, lines) {
  if (!count) return [];
  const ranked = [...lines].sort((x, y) => y.motion - x.motion);
  const fallback = [[100, 100]];
  const along = [0.35, 0.62, 0.48, 0.28, 0.72];
  const side = [14, -14, 18, -10, 10];
  return Array.from({ length: count }, (_, i) => {
    const line = ranked[i % Math.max(ranked.length, 1)];
    const [x1, y1] = line ? CORNERS[line.a] : fallback[0];
    const [x2, y2] = line ? CORNERS[line.b] : fallback[0];
    const t = along[i % along.length];
    // nudge sideways off the line so dots don't sit on top of each other
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
    const x = x1 + (x2 - x1) * t + nx * side[i % side.length];
    const y = y1 + (y2 - y1) * t + ny * side[i % side.length];
    return [Math.min(166, Math.max(34, x)), Math.min(166, Math.max(34, y))];
  });
}

export function MeshRadar({ mesh }) {
  if (!mesh) {
    return <div style={{ fontSize: 11, color: "#857DA8" }}>⚪ People count unavailable — backend not reachable</div>;
  }
  const pred = mesh.prediction;
  const sim = mesh.mode === "simulation";
  const lines = pairLines(mesh.links);
  const maxMotion = Math.max(10, ...lines.map((l) => l.motion));
  const n = pred ? (pred.label === "5+" ? 5 : pred.label === "2+" ? 2 : pred.label === "1+" ? 1 : Number(pred.label) || 0) : 0;
  const isLevels = pred?.source === "levels";
  const zone = pred?.zone && ZONE_SHAPES[pred.zone.label] ? pred.zone : null;
  // With a zone (one person), the dot sits in that zone. Otherwise dots only show the count.
  const spots = zone ? [ZONE_SHAPES[zone.label].anchor] : peopleSpots(n, lines);
  const onlineCount = Object.values(mesh.nodes).filter((d) => d.online).length;

  let headline, sub;
  if (pred) {
    headline = pred.label === "0" ? (isLevels ? "Empty" : "0 people") : pred.label === "1+" ? "Occupied" : pred.label === "1" ? "1 person" : `${pred.label} people`;
    sub = sim ? "simulated count" : isLevels
      ? `${Math.round((pred.confidence ?? 0) * 100)}% steady · calibrated levels (≈20 s average)`
      : `${Math.round((pred.confidence ?? 0) * 100)}% sure · model`;
    if (zone) sub += ` · ${pred.label === "1+" ? "movement near " : ""}${zone.label} zone${zone.confidence != null ? ` (${Math.round(zone.confidence * 100)}%)` : ""}`;
  } else if (!mesh.model.loaded) {
    headline = "Not trained yet";
    const rl = mesh.recording.label || "";
    sub = mesh.recording.active
      ? (rl.startsWith("z-") ? `recording one person in the ${rl.slice(2)} zone` : `recording “${rl}” people`)
      : "record labelled data to train the count model";
  } else {
    headline = "Waiting for boards";
    sub = `${mesh.pairsHeard} of 6 board pairs heard (need ${mesh.config.minLinks})`;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "rgba(167,139,250,0.04)", border: "1px solid rgba(196,181,253,0.1)", borderRadius: 14, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: MUTED, fontWeight: 700 }}>Wi-Fi people radar</span>
        {sim
          ? <span style={{ fontSize: 10.5, fontWeight: 700, color: "#07060C", background: "#E9E3FF", borderRadius: 999, padding: "2px 8px" }}>⚠ simulation</span>
          : <span style={{ fontSize: 10.5, color: MUTED, fontFamily: "'JetBrains Mono', monospace" }}>{onlineCount}/4 boards</span>}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <svg viewBox="0 0 200 200" width="150" height="150" role="img"
             aria-label={pred ? `Radar showing ${headline}` : "Radar, no count yet"} style={{ flexShrink: 0 }}>
          <defs>
            <radialGradient id="gsRadarBg" cx="50%" cy="50%" r="60%">
              <stop offset="0%" stopColor="#1C1630" />
              <stop offset="100%" stopColor="#0B0914" />
            </radialGradient>
            <linearGradient id="gsSweep" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={VIOLET} stopOpacity="0" />
              <stop offset="100%" stopColor={VIOLET} stopOpacity="0.35" />
            </linearGradient>
          </defs>
          <rect x="4" y="4" width="192" height="192" rx="16" fill="url(#gsRadarBg)" stroke="rgba(196,181,253,0.18)" />
          {[30, 55, 80].map((r) => (
            <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="rgba(196,181,253,0.08)" />
          ))}
          <line x1="100" y1="12" x2="100" y2="188" stroke="rgba(196,181,253,0.05)" />
          <line x1="12" y1="100" x2="188" y2="100" stroke="rgba(196,181,253,0.05)" />

          {/* the zone the model picked (one person only) */}
          {zone && (() => {
            const z = ZONE_SHAPES[zone.label];
            return z.circle
              ? <circle cx={C[0]} cy={C[1]} r={z.circle} fill={VIOLET} opacity="0.22" />
              : <polygon points={z.points.map((p) => p.join(",")).join(" ")} fill={VIOLET} opacity="0.18" />;
          })()}

          {/* links: brighter = more motion measured on that link */}
          {lines.map((l) => {
            const [x1, y1] = CORNERS[l.a]; const [x2, y2] = CORNERS[l.b];
            const k = Math.min(1, l.motion / maxMotion);
            return <line key={l.a + l.b} x1={x1} y1={y1} x2={x2} y2={y2}
                         stroke={LAVENDER} strokeOpacity={0.12 + 0.6 * k} strokeWidth={0.8 + 2.2 * k} />;
          })}

          {/* sweep */}
          <g>
            <path d="M100 100 L188 100 A88 88 0 0 0 162 38 Z" fill="url(#gsSweep)" />
            <animateTransform attributeName="transform" type="rotate" from="0 100 100" to="360 100 100" dur="3.2s" repeatCount="indefinite" />
          </g>

          {/* boards */}
          {Object.entries(CORNERS).map(([id, [x, y]]) => {
            const on = mesh.nodes[id]?.online;
            return (
              <g key={id}>
                <circle cx={x} cy={y} r={on ? 7 : 5} fill={on ? VIOLET : "#2A2440"} opacity={on ? 0.25 : 1} />
                <circle cx={x} cy={y} r="3.5" fill={on ? LAVENDER : FAINT} />
                <text x={x} y={y + (y < 100 ? -9 : 15)} textAnchor="middle" fontSize="8" fill={on ? MUTED : FAINT}
                      fontFamily="JetBrains Mono, monospace">{id.slice(5)}</text>
              </g>
            );
          })}

          {/* people: the count is real; positions are illustrative unless a zone is shown */}
          {spots.map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="7" fill={INK} opacity="0.12">
                <animate attributeName="r" values="5;9;5" dur="1.8s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
              </circle>
              <circle cx={x} cy={y} r="3.6" fill={INK} />
            </g>
          ))}
          {(pred?.label === "5+" || pred?.label === "2+" || pred?.label === "1+") && <text x="188" y="194" textAnchor="end" fontSize="10" fill={INK} fontWeight="700">+</text>}
        </svg>

        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 120, flex: 1 }}>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 24, fontWeight: 700, color: pred ? INK : MUTED, lineHeight: 1.1 }}>{headline}</div>
          <div style={{ fontSize: 11.5, color: MUTED }}>{sub}</div>
          {mesh.model.loaded && mesh.model.testAccuracy != null && !sim && (
            <div style={{ fontSize: 10.5, color: FAINT, fontFamily: "'JetBrains Mono', monospace" }}>
              {mesh.model.kind === "levels" ? "levels held-out" : "test accuracy"} {Math.round(mesh.model.testAccuracy * 100)}%
              {mesh.model.withinOneAccuracy != null && ` · ±1: ${Math.round(mesh.model.withinOneAccuracy * 100)}%`}
            </div>
          )}
          {mesh.recording.active && (
            <div style={{ fontSize: 10.5, color: AMBER, fontWeight: 700 }}>● recording label “{mesh.recording.label}”</div>
          )}
        </div>
      </div>

      <div style={{ fontSize: 10, color: FAINT, lineHeight: 1.45 }}>
        {zone
          ? "One person: count and zone estimated from Wi-Fi signals by models trained in this room. The zone is a rough area, not an exact spot."
          : "Count estimated from Wi-Fi signals between the boards by a model trained in this room. Dots show the count, not exact positions."}
      </div>
    </div>
  );
}

// Extra rows for the developer dashboard.
export function MeshDevRows({ mesh, row }) {
  if (!mesh) return row("Mesh", "backend unreachable");
  const rec = mesh.recording;
  return (
    <>
      {row("Mesh mode", mesh.mode)}
      {Object.entries(mesh.nodes).map(([id, d]) => <span key={id}>{row(`Board ${id}`, d.online ? "ONLINE" : "OFFLINE")}</span>)}
      {row("Board pairs heard", `${mesh.pairsHeard} / 6`)}
      {row("Model", mesh.model.loaded ? `loaded${mesh.model.trainedAt ? " · " + mesh.model.trainedAt.slice(0, 10) : ""}` : mesh.model.reason || "not loaded")}
      {mesh.model.loaded && row("Held-out accuracy", mesh.model.testAccuracy == null ? "not tested" : `${Math.round(mesh.model.testAccuracy * 100)}%`)}
      {row("Zone model", mesh.zoneModel?.loaded
        ? `loaded${mesh.zoneModel.testAccuracy != null ? ` · ${Math.round(mesh.zoneModel.testAccuracy * 100)}% held-out` : ""}`
        : mesh.zoneModel?.reason || "not loaded")}
      {row("Recording", rec.active ? `ON · label ${rec.label}` : "off")}
      {row("Recorded windows", Object.entries(rec.rowsByLabel).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(" ") || "none")}
    </>
  );
}
