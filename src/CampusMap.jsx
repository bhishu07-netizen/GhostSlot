import React, { useEffect, useMemo, useRef, useState } from "react";
import { Radar, Wifi, CalendarClock, MapPin, Clock, Users, ChevronRight, Search, LocateFixed, Navigation, Crosshair } from "lucide-react";
import { MAP_ZONES, CATEGORIES, CAMPUS_MAP_IMAGE, crowdLabel } from "./campus";
import { walkMinutes, walkLabel, nearestPlace, fitGeo, loadAnchors, directionsUrl } from "./location";

const TONE = { lime: "#3DDC97", amber: "#F5B544", coral: "#FF6B6B", grey: "#6A6390" };
const SENSING = {
  timetable: { icon: CalendarClock, label: "Timetable + bookings" },
  wifi: { icon: Wifi, label: "Wi-Fi crowd estimate" },
  csi: { icon: Radar, label: "Wi-Fi CSI sensing" },
};

// One status → colour/label rule for every pin and card on the map.
export function pinState(room, status, booking) {
  if (booking && booking.roomId === room.id) return { tone: "lime", text: "booked by you" };
  if (room.sensing === "wifi") {
    if (status.closed) return { tone: "grey", text: `closed · opens ${status.busyUntil}` };
    if (status.full) return { tone: "coral", text: `packed · ${status.crowd}% full` };
    const c = crowdLabel(status.crowd);
    return { tone: c.tone, text: `${c.label} · ${status.crowd}% full` };
  }
  return status.free ? { tone: "lime", text: "free now" } : { tone: "coral", text: `occupied · free at ${status.busyUntil}` };
}

export default function CampusMap({ rooms, booking, csi, onShowInFind, onBook, you, onSetYou, places = [], focusId, anchorsVersion = 0 }) {
  const [cat, setCat] = useState(null);
  const [selectedId, setSelectedId] = useState(focusId || "food-republic");
  const [placing, setPlacing] = useState(false);
  const svgRef = useRef(null);
  // "Take me there" from Find: jump to that place and show the route.
  useEffect(() => { if (focusId) { setSelectedId(focusId); setCat(null); } }, [focusId]);
  const geo = useMemo(() => fitGeo(loadAnchors()), [anchorsVersion]);

  // Tap on the map in "set my spot" mode → convert screen → map coordinates.
  function handleMapTap(e) {
    if (!placing || !onSetYou || !svgRef.current) return;
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const p = pt.matrixTransform(ctm.inverse());
    const near = nearestPlace(places, p.x, p.y);
    onSetYou({ x: p.x, y: p.y, label: near ? `near ${near.label}` : "on campus", source: "map", at: Date.now() });
    setPlacing(false);
  }
  const shown = useMemo(() => rooms.filter(({ room }) => !cat || room.category === cat), [rooms, cat]);
  const selected = rooms.find(({ room }) => room.id === selectedId) || shown[0];

  const counts = useMemo(() => {
    const c = { lime: 0, amber: 0, coral: 0, grey: 0 };
    shown.forEach(({ room, status }) => { c[pinState(room, status, booking).tone] += 1; });
    return c;
  }, [shown, booking]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
        {CATEGORIES.map((c) => (
          <button key={String(c.id)} onClick={() => setCat(c.id)} style={{ flexShrink: 0, background: cat === c.id ? "#E9E3FF" : "#120F1E", color: cat === c.id ? "#07060C" : "#F4F1FF", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 999, padding: "7px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
            {c.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11.5, color: "#A39CC4" }}>
        <span style={{ color: "#F4F1FF", fontWeight: 600 }}>Right now:</span>
        {[["lime", "free / quiet"], ["amber", "moderate"], ["coral", "busy / occupied"], ["grey", "closed"]].map(([t, l]) => (
          <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: TONE[t] }} /> {counts[t]} {l}
          </span>
        ))}
      </div>

      {onSetYou && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => setPlacing((v) => !v)} aria-pressed={placing} style={{ background: placing ? "linear-gradient(180deg, #C4B5FD, #8B5CF6)" : "rgba(196,181,253,0.06)", color: placing ? "#0A0812" : "#E9E3FF", border: placing ? "none" : "1px solid rgba(196,181,253,0.16)", borderRadius: 10, padding: "7px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, boxShadow: placing ? "0 0 18px rgba(139,92,246,0.45)" : "none" }}>
            <Crosshair size={13} /> {placing ? "Tap the map where you are…" : you ? "Move my spot" : "Set my spot on the map"}
          </button>
          {you && <span style={{ fontSize: 11.5, color: "#A39CC4" }}>Routes and walking times start from the <b style={{ color: "#C4B5FD" }}>You</b> dot.</span>}
        </div>
      )}

      {/* The map scrolls sideways on phones so pins stay big enough to tap. */}
      <div style={{ overflowX: "auto", borderRadius: 18, border: "1px solid rgba(196,181,253,0.07)", background: "linear-gradient(180deg, #100D1B, #0A0812)" }}>
        <svg ref={svgRef} onClick={handleMapTap} viewBox="90 96 910 544" role="img" aria-label="Schematic map of Chandigarh University campus with live status pins" style={{ display: "block", width: "100%", minWidth: 680, height: "auto", cursor: placing ? "crosshair" : "default" }}>
          <style>{`
            @keyframes gs-pulse { 0% { r: 12; opacity: .55 } 100% { r: 30; opacity: 0 } }
            .gs-pulse { animation: gs-pulse 1.8s ease-out infinite; }
            @keyframes gs-dash { to { stroke-dashoffset: -28 } }
            .gs-route { animation: gs-dash 1.2s linear infinite; }
            @media (prefers-reduced-motion: reduce) { .gs-pulse { animation: none; opacity: 0 } .gs-route { animation: none } }
          `}</style>
          {CAMPUS_MAP_IMAGE ? (
            <image href={CAMPUS_MAP_IMAGE} x="0" y="0" width="1000" height="640" preserveAspectRatio="xMidYMid slice" opacity="0.55" />
          ) : (
            <>
              {/* roads */}
              <rect x="0" y="596" width="1000" height="44" fill="#1A1630" />
              <line x1="0" y1="618" x2="1000" y2="618" stroke="#3A3159" strokeDasharray="14 12" strokeWidth="2" />
              <text x="110" y="633" fill="#6A6390" fontSize="12" fontFamily="'JetBrains Mono', monospace">NH-05 · CHANDIGARH–LUDHIANA HIGHWAY</text>
              <rect x="486" y="80" width="26" height="516" rx="4" fill="#141123" />
              <rect x="90" y="266" width="900" height="16" rx="4" fill="#141123" />
              <rect x="90" y="472" width="530" height="16" rx="4" fill="#141123" />
              <g transform="translate(499 590)">
                <rect x="-38" y="-14" width="76" height="22" rx="11" fill="#C4B5FD" />
                <text x="0" y="1" textAnchor="middle" fill="#0A0812" fontSize="11" fontWeight="700" fontFamily="'Inter', sans-serif">MAIN GATE</text>
              </g>
              {/* buildings and areas */}
              {MAP_ZONES.map((z) => (
                <g key={z.label}>
                  <rect x={z.x} y={z.y} width={z.w} height={z.h} rx="14"
                    fill={z.kind === "ground" ? "rgba(61,220,151,0.06)" : z.kind === "sport" ? "rgba(245,181,68,0.05)" : "#120F1E"}
                    stroke={z.kind === "ground" ? "rgba(61,220,151,0.25)" : z.kind === "sport" ? "rgba(245,181,68,0.22)" : "#261F42"} strokeWidth="1.5" />
                  <text x={z.x + 12} y={z.y + 22} fill="#A39CC4" fontSize="12.5" fontWeight="600" fontFamily="'Inter', sans-serif">{z.label}</text>
                </g>
              ))}
              <circle cx="552" cy="418" r="32" fill="rgba(167,139,250,0.05)" stroke="#3A3159" strokeDasharray="4 5" />
            </>
          )}
          {/* route from you to the selected place */}
          {you && selected?.room.pos && (() => {
            const p = selected.room.pos, mx = (you.x + p.x) / 2, my = (you.y + p.y) / 2;
            const mins = walkMinutes(you, p);
            return (
              <g style={{ pointerEvents: "none" }}>
                <line x1={you.x} y1={you.y} x2={p.x} y2={p.y} stroke="#8B5CF6" strokeOpacity="0.35" strokeWidth="9" strokeLinecap="round" />
                <line className="gs-route" x1={you.x} y1={you.y} x2={p.x} y2={p.y} stroke="#C4B5FD" strokeWidth="3" strokeDasharray="10 4" strokeLinecap="round" />
                <g transform={`translate(${mx} ${my - 14})`}>
                  <rect x="-34" y="-12" width="68" height="22" rx="11" fill="#8B5CF6" />
                  <text y="3" textAnchor="middle" fill="#0A0812" fontSize="11.5" fontWeight="800" fontFamily="'Inter', sans-serif">~{mins} min</text>
                </g>
              </g>
            );
          })()}
          {/* pins */}
          {shown.map(({ room, status }) => {
            const p = room.pos;
            if (!p) return null;
            const st = pinState(room, status, booking);
            const isSel = selected && selected.room.id === room.id;
            const Icon = SENSING[room.sensing]?.icon || MapPin;
            return (
              <g key={room.id} transform={`translate(${p.x} ${p.y})`} onClick={(e) => { e.stopPropagation(); if (placing && onSetYou) { onSetYou({ x: p.x, y: p.y, label: room.name, placeId: room.id, source: "map", at: Date.now() }); setPlacing(false); } else setSelectedId(room.id); }} style={{ cursor: "pointer", outline: "none" }}
                role="button" tabIndex={0} aria-label={`${room.name}: ${st.text}`} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSelectedId(room.id)}>
                {room.sensing === "csi" && <circle className="gs-pulse" r="12" fill="none" stroke="#C4B5FD" strokeWidth="2" />}
                <circle r={isSel ? 17 : 14} fill="#0A0812" stroke={TONE[st.tone]} strokeWidth={isSel ? 4 : 3} />
                <foreignObject x="-8" y="-8" width="16" height="16" style={{ pointerEvents: "none" }}>
                  <Icon size={16} color={TONE[st.tone]} />
                </foreignObject>
                {isSel && (
                  <g transform="translate(0 -30)">
                    <rect x={-room.name.length * 3.6 - 10} y="-14" width={room.name.length * 7.2 + 20} height="22" rx="11" fill="#E9E3FF" />
                    <text y="1" textAnchor="middle" fill="#0A0812" fontSize="12" fontWeight="700" fontFamily="'Inter', sans-serif">{room.name}</text>
                  </g>
                )}
              </g>
            );
          })}
          {you && (
            <g transform={`translate(${you.x} ${you.y})`} style={{ pointerEvents: "none" }}>
              <circle className="gs-pulse" r="12" fill="none" stroke="#8B5CF6" strokeWidth="3" />
              <circle r="11" fill="#8B5CF6" stroke="#F4F1FF" strokeWidth="3" style={{ filter: "drop-shadow(0 0 8px rgba(139,92,246,0.9))" }} />
              <g transform="translate(0 26)">
                <rect x="-20" y="-11" width="40" height="19" rx="9.5" fill="#F4F1FF" />
                <text y="3" textAnchor="middle" fill="#0A0812" fontSize="11" fontWeight="800" fontFamily="'Inter', sans-serif">You</text>
              </g>
            </g>
          )}
        </svg>
      </div>
      <div style={{ fontSize: 10.5, color: "#6A6390", marginTop: -4 }}>
        Schematic layout, not to scale. Campus Wi-Fi crowd levels are simulated in this prototype.
      </div>

      {selected && <SpaceDetail item={selected} booking={booking} csi={csi} onShowInFind={onShowInFind} onBook={onBook} you={you} geo={geo} />}

      <div>
        <div style={{ fontSize: 11.5, color: "#857DA8", fontFamily: "'JetBrains Mono', monospace", margin: "4px 0 6px" }}>ALL PLACES · TAP TO SELECT</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {shown.map(({ room, status }) => {
            const st = pinState(room, status, booking);
            return (
              <button key={room.id} onClick={() => setSelectedId(room.id)} style={{ textAlign: "left", background: selected?.room.id === room.id ? "#1A1630" : "#120F1E", border: "1px solid rgba(196,181,253,0.06)", borderRadius: 12, padding: "9px 12px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", color: "#F4F1FF" }}>
                <span style={{ width: 9, height: 9, borderRadius: 99, background: TONE[st.tone], flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{room.name}</span>
                  <span style={{ display: "block", fontSize: 11, color: "#857DA8" }}>{room.block} · {st.text}{you && room.pos ? ` · ${walkLabel(walkMinutes(you, room.pos))}` : ""}</span>
                </span>
                <ChevronRight size={14} color="#6A6390" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SpaceDetail({ item, booking, csi, onShowInFind, onBook, you, geo }) {
  const { room, status } = item;
  const st = pinState(room, status, booking);
  const S = SENSING[room.sensing] || SENSING.timetable;
  const SIcon = S.icon;
  const canBook = room.bookable && status.free && !booking;
  const mins = you && room.pos ? walkMinutes(you, room.pos) : null;
  const gmaps = geo && geo.toGeo && room.pos ? directionsUrl(geo.toGeo(room.pos.x, room.pos.y)) : null;
  return (
    <div style={{ background: "linear-gradient(180deg, #1B1732, #100D1B)", border: "1px solid rgba(196,181,253,0.09)", borderRadius: 18, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 18 }}>{room.name}</div>
          <div style={{ fontSize: 12, color: "#A39CC4", marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span><MapPin size={11} style={{ verticalAlign: -1 }} /> {room.block}</span>
            {room.hours && <span><Clock size={11} style={{ verticalAlign: -1 }} /> {room.hours[0]}–{room.hours[1]}</span>}
            <span><Users size={11} style={{ verticalAlign: -1 }} /> {room.capacity}</span>
            {mins != null && <span style={{ color: "#C4B5FD", fontWeight: 600 }}><Navigation size={11} style={{ verticalAlign: -1 }} /> ~{walkLabel(mins)} from you</span>}
          </div>
        </div>
        <span style={{ flexShrink: 0, fontSize: 11, fontFamily: "'JetBrains Mono', monospace", padding: "3px 8px", borderRadius: 999, color: TONE[st.tone], border: `1px solid ${TONE[st.tone]}55`, background: `${TONE[st.tone]}1A` }}>{st.text}</span>
      </div>
      {room.sensing === "wifi" && !status.closed && (
        <div>
          <div style={{ height: 8, borderRadius: 99, background: "#221C3B", overflow: "hidden" }}>
            <div style={{ width: `${status.crowd}%`, height: "100%", background: TONE[st.tone], borderRadius: 99 }} />
          </div>
        </div>
      )}
      <div style={{ fontSize: 12.5, color: "#CFC7EC", lineHeight: 1.5 }}>{room.description}</div>
      <div style={{ fontSize: 11.5, color: "#A39CC4", display: "flex", alignItems: "center", gap: 6 }}>
        <SIcon size={13} color="#C4B5FD" /> Sensed by: {S.label}
        {room.sensing === "csi" && csi && (() => {
          // csi = 4-board mesh status: show the live people count or the board status
          const on = Object.values(csi.nodes || {}).filter((n) => n.online).length;
          const p = csi.prediction;
          const txt = csi.mode === "simulation" ? "Wi-Fi mesh (simulation)"
            : p ? (/^\d+$/.test(p.label) ? `Wi-Fi: ${p.label === "0" ? "empty" : `${p.label} ${p.label === "1" ? "person" : "people"}`}` : p.label === "1+" ? "Wi-Fi: occupied" : p.label === "0" ? "Wi-Fi: empty" : `Wi-Fi: ${p.label}`)
            : on >= 2 ? `Wi-Fi mesh live · ${on}/4 boards` : "Wi-Fi boards offline";
          return <span style={{ color: "#CFC7EC" }}>· {txt}</span>;
        })()}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {room.bookable && onBook && (
          <button onClick={() => canBook && onBook(room, status)} disabled={!canBook} style={{ background: canBook ? "linear-gradient(180deg, #F1ECFF, #A78BFA)" : "rgba(196,181,253,0.06)", color: canBook ? "#0A0812" : "#857DA8", border: "none", borderRadius: 10, padding: "9px 14px", fontWeight: 700, fontSize: 13, cursor: canBook ? "pointer" : "not-allowed" }}>
            {booking ? (booking.roomId === room.id ? "Booked by you" : "End current booking first") : status.free ? "Lock it in" : "Not free right now"}
          </button>
        )}
        {!room.bookable && onBook && (
          <span style={{ fontSize: 12, color: "#A39CC4", padding: "9px 0" }}>Walk in · no booking needed</span>
        )}
        {gmaps && <a href={gmaps} target="_blank" rel="noopener noreferrer" style={{ background: "rgba(139,92,246,0.16)", border: "1px solid rgba(139,92,246,0.45)", color: "#E9E3FF", borderRadius: 10, padding: "9px 12px", fontSize: 12.5, fontWeight: 700, textDecoration: "none", display: "flex", alignItems: "center", gap: 5 }}>
          <Navigation size={13} /> Walking directions
        </a>}
        {onShowInFind && <button onClick={() => onShowInFind(room)} style={{ background: "#1A1630", border: "1px solid #322A50", color: "#F4F1FF", borderRadius: 10, padding: "9px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
          <Search size={13} /> Similar places in Find
        </button>}
      </div>
    </div>
  );
}
