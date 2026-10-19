import React, { useMemo, useState } from "react";
import { Radar, Wifi, CalendarClock, MapPin, Clock, Users, ChevronRight, Search } from "lucide-react";
import { MAP_ZONES, CATEGORIES, CAMPUS_MAP_IMAGE, crowdLabel } from "./campus";

const TONE = { lime: "#3DDC97", amber: "#F5B544", coral: "#FF6B6B", grey: "#5F636D" };
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

export default function CampusMap({ rooms, booking, csi, onShowInFind, onBook }) {
  const [cat, setCat] = useState(null);
  const [selectedId, setSelectedId] = useState("food-republic");
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
          <button key={String(c.id)} onClick={() => setCat(c.id)} style={{ flexShrink: 0, background: cat === c.id ? "#E6E8EC" : "#101114", color: cat === c.id ? "#060607" : "#F4F5F7", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 999, padding: "7px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
            {c.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11.5, color: "#8B8F99" }}>
        <span style={{ color: "#F4F5F7", fontWeight: 600 }}>Right now:</span>
        {[["lime", "free / quiet"], ["amber", "moderate"], ["coral", "busy / occupied"], ["grey", "closed"]].map(([t, l]) => (
          <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: TONE[t] }} /> {counts[t]} {l}
          </span>
        ))}
      </div>

      {/* The map scrolls sideways on phones so pins stay big enough to tap. */}
      <div style={{ overflowX: "auto", borderRadius: 18, border: "1px solid rgba(255,255,255,0.07)", background: "linear-gradient(180deg, #0E0F12, #08090B)" }}>
        <svg viewBox="90 96 910 544" role="img" aria-label="Schematic map of Chandigarh University campus with live status pins" style={{ display: "block", width: "100%", minWidth: 680, height: "auto" }}>
          <style>{`
            @keyframes gs-pulse { 0% { r: 12; opacity: .55 } 100% { r: 30; opacity: 0 } }
            .gs-pulse { animation: gs-pulse 1.8s ease-out infinite; }
            @media (prefers-reduced-motion: reduce) { .gs-pulse { animation: none; opacity: 0 } }
          `}</style>
          {CAMPUS_MAP_IMAGE ? (
            <image href={CAMPUS_MAP_IMAGE} x="0" y="0" width="1000" height="640" preserveAspectRatio="xMidYMid slice" opacity="0.55" />
          ) : (
            <>
              {/* roads */}
              <rect x="0" y="596" width="1000" height="44" fill="#16171B" />
              <line x1="0" y1="618" x2="1000" y2="618" stroke="#34373F" strokeDasharray="14 12" strokeWidth="2" />
              <text x="110" y="633" fill="#5F636D" fontSize="12" fontFamily="'JetBrains Mono', monospace">NH-05 · CHANDIGARH–LUDHIANA HIGHWAY</text>
              <rect x="486" y="80" width="26" height="516" rx="4" fill="#121317" />
              <rect x="90" y="266" width="900" height="16" rx="4" fill="#121317" />
              <rect x="90" y="472" width="530" height="16" rx="4" fill="#121317" />
              <g transform="translate(499 590)">
                <rect x="-38" y="-14" width="76" height="22" rx="11" fill="#D3D7DF" />
                <text x="0" y="1" textAnchor="middle" fill="#08090B" fontSize="11" fontWeight="700" fontFamily="'Inter', sans-serif">MAIN GATE</text>
              </g>
              {/* buildings and areas */}
              {MAP_ZONES.map((z) => (
                <g key={z.label}>
                  <rect x={z.x} y={z.y} width={z.w} height={z.h} rx="14"
                    fill={z.kind === "ground" ? "rgba(61,220,151,0.06)" : z.kind === "sport" ? "rgba(245,181,68,0.05)" : "#101114"}
                    stroke={z.kind === "ground" ? "rgba(61,220,151,0.25)" : z.kind === "sport" ? "rgba(245,181,68,0.22)" : "#22242A"} strokeWidth="1.5" />
                  <text x={z.x + 12} y={z.y + 22} fill="#8B8F99" fontSize="12.5" fontWeight="600" fontFamily="'Inter', sans-serif">{z.label}</text>
                </g>
              ))}
              <circle cx="552" cy="418" r="32" fill="rgba(211,215,223,0.05)" stroke="#34373F" strokeDasharray="4 5" />
            </>
          )}
          {/* pins */}
          {shown.map(({ room, status }) => {
            const p = room.pos;
            if (!p) return null;
            const st = pinState(room, status, booking);
            const isSel = selected && selected.room.id === room.id;
            const Icon = SENSING[room.sensing]?.icon || MapPin;
            return (
              <g key={room.id} transform={`translate(${p.x} ${p.y})`} onClick={() => setSelectedId(room.id)} style={{ cursor: "pointer", outline: "none" }}
                role="button" tabIndex={0} aria-label={`${room.name}: ${st.text}`} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSelectedId(room.id)}>
                {room.sensing === "csi" && <circle className="gs-pulse" r="12" fill="none" stroke="#D3D7DF" strokeWidth="2" />}
                <circle r={isSel ? 17 : 14} fill="#08090B" stroke={TONE[st.tone]} strokeWidth={isSel ? 4 : 3} />
                <foreignObject x="-8" y="-8" width="16" height="16" style={{ pointerEvents: "none" }}>
                  <Icon size={16} color={TONE[st.tone]} />
                </foreignObject>
                {isSel && (
                  <g transform="translate(0 -30)">
                    <rect x={-room.name.length * 3.6 - 10} y="-14" width={room.name.length * 7.2 + 20} height="22" rx="11" fill="#E6E8EC" />
                    <text y="1" textAnchor="middle" fill="#08090B" fontSize="12" fontWeight="700" fontFamily="'Inter', sans-serif">{room.name}</text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div style={{ fontSize: 10.5, color: "#5F636D", marginTop: -4 }}>
        Schematic layout, not to scale. Campus Wi-Fi crowd levels are simulated in this prototype.
      </div>

      {selected && <SpaceDetail item={selected} booking={booking} csi={csi} onShowInFind={onShowInFind} onBook={onBook} />}

      <div>
        <div style={{ fontSize: 11.5, color: "#6B6F79", fontFamily: "'JetBrains Mono', monospace", margin: "4px 0 6px" }}>ALL PLACES · TAP TO SELECT</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {shown.map(({ room, status }) => {
            const st = pinState(room, status, booking);
            return (
              <button key={room.id} onClick={() => setSelectedId(room.id)} style={{ textAlign: "left", background: selected?.room.id === room.id ? "#16171B" : "#101114", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "9px 12px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", color: "#F4F5F7" }}>
                <span style={{ width: 9, height: 9, borderRadius: 99, background: TONE[st.tone], flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{room.name}</span>
                  <span style={{ display: "block", fontSize: 11, color: "#6B6F79" }}>{room.block} · {st.text}</span>
                </span>
                <ChevronRight size={14} color="#5F636D" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SpaceDetail({ item, booking, csi, onShowInFind, onBook }) {
  const { room, status } = item;
  const st = pinState(room, status, booking);
  const S = SENSING[room.sensing] || SENSING.timetable;
  const SIcon = S.icon;
  const canBook = room.bookable && status.free && !booking;
  return (
    <div style={{ background: "linear-gradient(180deg, #17181D, #0E0F12)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 18, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 18 }}>{room.name}</div>
          <div style={{ fontSize: 12, color: "#8B8F99", marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span><MapPin size={11} style={{ verticalAlign: -1 }} /> {room.block}</span>
            {room.hours && <span><Clock size={11} style={{ verticalAlign: -1 }} /> {room.hours[0]}–{room.hours[1]}</span>}
            <span><Users size={11} style={{ verticalAlign: -1 }} /> {room.capacity}</span>
          </div>
        </div>
        <span style={{ flexShrink: 0, fontSize: 11, fontFamily: "'JetBrains Mono', monospace", padding: "3px 8px", borderRadius: 999, color: TONE[st.tone], border: `1px solid ${TONE[st.tone]}55`, background: `${TONE[st.tone]}1A` }}>{st.text}</span>
      </div>
      {room.sensing === "wifi" && !status.closed && (
        <div>
          <div style={{ height: 8, borderRadius: 99, background: "#1E2026", overflow: "hidden" }}>
            <div style={{ width: `${status.crowd}%`, height: "100%", background: TONE[st.tone], borderRadius: 99 }} />
          </div>
        </div>
      )}
      <div style={{ fontSize: 12.5, color: "#C9CCD3", lineHeight: 1.5 }}>{room.description}</div>
      <div style={{ fontSize: 11.5, color: "#8B8F99", display: "flex", alignItems: "center", gap: 6 }}>
        <SIcon size={13} color="#D3D7DF" /> Sensed by: {S.label}
        {room.sensing === "csi" && csi && <span style={{ color: "#C9CCD3" }}>· {csi.state}{csi.mode === "simulation" ? " (simulation)" : ""}</span>}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {room.bookable && onBook && (
          <button onClick={() => canBook && onBook(room, status)} disabled={!canBook} style={{ background: canBook ? "linear-gradient(180deg, #ECEEF2, #B9BEC9)" : "rgba(255,255,255,0.06)", color: canBook ? "#08090B" : "#6B6F79", border: "none", borderRadius: 10, padding: "9px 14px", fontWeight: 700, fontSize: 13, cursor: canBook ? "pointer" : "not-allowed" }}>
            {booking ? (booking.roomId === room.id ? "Booked by you" : "End current booking first") : status.free ? "Lock it in" : "Not free right now"}
          </button>
        )}
        {!room.bookable && onBook && (
          <span style={{ fontSize: 12, color: "#8B8F99", padding: "9px 0" }}>Walk in · no booking needed</span>
        )}
        {onShowInFind && <button onClick={() => onShowInFind(room)} style={{ background: "#16171B", border: "1px solid #2E3138", color: "#F4F5F7", borderRadius: 10, padding: "9px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
          <Search size={13} /> Similar places in Find
        </button>}
      </div>
    </div>
  );
}
