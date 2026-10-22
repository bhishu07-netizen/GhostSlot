// Faculty home: today's teaching, and a quick way to find and book a room
// for an extra or make-up class that fits the section size. Uses the same
// timetable-based room status as the rest of the app.
import React, { useMemo, useState } from "react";
import { BookOpen, CalendarClock, Users, Clock, MapPin, AlertTriangle, CheckCircle2 } from "lucide-react";

const C = { card: "#120F1E", border: "rgba(196,181,253,0.07)", text: "#F4F1FF", sub: "#A39CC4", muted: "#857DA8", silver: "#C4B5FD", good: "#3DDC97", warn: "#F5B544", blue: "#5B9BEA" };
const head = "'Space Grotesk', sans-serif";
const mono = "'JetBrains Mono', monospace";
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const DURATIONS = [45, 60, 90, 120];

function Card({ children, style }) {
  return <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 14, ...style }}>{children}</div>;
}
function Title({ icon: Icon, children, sub }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontFamily: head, fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 7 }}>{Icon && <Icon size={15} color={C.silver} />}{children}</div>
      {sub && <div style={{ fontSize: 11.5, color: C.sub, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
const chip = (active) => ({
  background: active ? "rgba(167,139,250,0.15)" : "rgba(196,181,253,0.04)", color: active ? "#E9E3FF" : "#CFC7EC",
  border: `1px solid ${active ? "rgba(167,139,250,0.35)" : "rgba(196,181,253,0.1)"}`, borderRadius: 9, padding: "6px 10px", fontSize: 12, cursor: "pointer",
});

export default function FacultyHome({ user, day, time, mySlots, rooms, booking, onBook, onOpenTimetable }) {
  const nowMin = toMin(time);
  const [size, setSize] = useState("60");
  const [duration, setDuration] = useState(60);
  const [subject, setSubject] = useState("");

  const today = useMemo(() => mySlots.filter((s) => s.day === day).sort((a, b) => toMin(a.start) - toMin(b.start)), [mySlots, day]);
  const next = today.find((s) => toMin(s.end) > nowMin);
  const title = user.name.startsWith("Dr.") || user.name.startsWith("Prof.") ? user.name.split(" ").slice(0, 2).join(" ") : user.name.split(" ")[0];

  const needed = Math.max(1, Number(size) || 1);
  const endMin = nowMin + duration;
  const clash = today.find((s) => toMin(s.start) < endMin && toMin(s.end) > nowMin);
  const anyClosed = rooms.some(({ room, status }) => room.category === "study" && status.closed);
  const fits = rooms
    .filter(({ room, status }) => room.category === "study" && room.bookable !== false && status.free && room.capacity >= needed && status.freeFor >= duration)
    .sort((a, b) => a.room.capacity - b.room.capacity);

  return (
    <div style={{ padding: "0 18px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontFamily: head, fontWeight: 700, fontSize: 18 }}>Good to see you, {title}</div>
        <div style={{ fontSize: 11.5, color: C.sub }}>{user.department ? `${user.department} · ` : ""}{day} {time} IST · {today.length} class{today.length === 1 ? "" : "es"} today</div>
      </div>

      <Card>
        <Title icon={CalendarClock} sub={next ? (toMin(next.start) <= nowMin ? `Teaching now: ${next.subject}` : `Next: ${next.subject} at ${next.start}`) : today.length ? "Done for the day." : "No classes on your timetable today."}>Today's classes</Title>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {today.map((s) => {
            const st = toMin(s.end) <= nowMin ? "done" : toMin(s.start) <= nowMin ? "now" : "later";
            const col = st === "now" ? C.good : st === "done" ? C.muted : C.blue;
            return (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: "rgba(196,181,253,0.03)", borderRadius: 10, padding: "8px 10px", borderLeft: `3px solid ${col}`, opacity: st === "done" ? 0.6 : 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s.subject}</div>
                <div style={{ fontFamily: mono, fontSize: 11.5, color: C.sub, whiteSpace: "nowrap" }}>{s.start}–{s.end}{st === "now" ? " · now" : ""}</div>
              </div>
            );
          })}
        </div>
        <button onClick={onOpenTimetable} style={{ ...chip(false), marginTop: 10 }}>Edit my teaching timetable</button>
      </Card>

      <Card>
        <Title icon={BookOpen} sub={`Rooms free from ${time} for the whole class, smallest that fits first so big halls stay open.`}>Book a room for an extra class</Title>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 10 }}>
          <label style={{ fontSize: 11, color: C.sub, display: "flex", flexDirection: "column", gap: 4, flex: "1 1 120px" }}>Students
            <input type="number" min="1" max="300" inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value)} style={{ background: "#0B0914", border: "1px solid #322A50", borderRadius: 10, padding: "8px 10px", color: C.text, fontSize: 13 }} />
          </label>
          <label style={{ fontSize: 11, color: C.sub, display: "flex", flexDirection: "column", gap: 4, flex: "2 1 160px" }}>Class / topic (optional)
            <input value={subject} maxLength={40} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. DBMS make-up class" style={{ background: "#0B0914", border: "1px solid #322A50", borderRadius: 10, padding: "8px 10px", color: C.text, fontSize: 13 }} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {DURATIONS.map((d) => <button key={d} onClick={() => setDuration(d)} aria-pressed={duration === d} style={chip(duration === d)}><Clock size={11} style={{ verticalAlign: -1, marginRight: 4 }} />{d} min</button>)}
        </div>

        {clash && (
          <div role="note" style={{ fontSize: 11.5, color: C.warn, display: "flex", gap: 6, marginBottom: 8 }}>
            <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> This overlaps your {clash.subject} ({clash.start}–{clash.end}).
          </div>
        )}
        {anyClosed && fits.length === 0 && <div style={{ fontSize: 12.5, color: C.sub }}>Teaching rooms are closed at this time (open 09:00–17:00, Mon–Sat). Pick another day or time at the top.</div>}
        {!anyClosed && fits.length === 0 && <div style={{ fontSize: 12.5, color: C.sub }}>No room is free for {duration} min with {needed} seats from {time}. Try a shorter class or a smaller group.</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {fits.map(({ room, status }) => {
            const mine = booking?.roomId === room.id;
            return (
              <div key={room.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: "rgba(196,181,253,0.03)", borderRadius: 10, padding: "9px 10px" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{room.name}</div>
                  <div style={{ fontSize: 11, color: C.sub, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span><Users size={10} style={{ verticalAlign: -1 }} /> {room.capacity} seats</span>
                    <span><MapPin size={10} style={{ verticalAlign: -1 }} /> {room.block}</span>
                    <span>free till {toHHMM(status.freeUntilMin)}</span>
                  </div>
                </div>
                {mine ? (
                  <span style={{ fontSize: 11.5, color: C.good, display: "flex", gap: 4, alignItems: "center", whiteSpace: "nowrap" }}><CheckCircle2 size={12} /> booked</span>
                ) : (
                  <button disabled={!!booking} onClick={() => onBook(room, duration, subject.trim() || "Extra class")} style={{ background: booking ? "rgba(196,181,253,0.06)" : "#C4B5FD", color: booking ? "#857DA8" : "#07060C", border: "none", borderRadius: 10, padding: "8px 12px", fontWeight: 700, fontSize: 12, cursor: booking ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
                    Book {toHHMM(nowMin)}–{toHHMM(endMin)}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {booking && <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>You have one active booking. End it from the bar at the top to book another.</div>}
      </Card>
    </div>
  );
}
