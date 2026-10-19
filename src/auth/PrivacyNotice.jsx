import React from "react";
import { X, ShieldCheck } from "lucide-react";

// Plain-language privacy notice (DPDP Act 2023, s.5 "notice" requirement).
// Shown at signup and from the You tab.
export const GRIEVANCE_CONTACT = "Team COGNIX (GhostSlot), Dept. of CSE, Chandigarh University";

const SECTIONS = [
  ["What we collect", [
    "Your name, your ID (student roll number, employee ID or staff ID) and whether you're a student, faculty member or facilities staff. Faculty and facilities also give their department or team.",
    "If you're facilities staff and log a meter reading, we record that your account logged it.",
    "Your password, stored only as a salted scrypt hash. Nobody can read it back, including us.",
    "The fact that you passed the age check (18+, or under 18 with a guardian's approval), and when.",
    "A login session cookie (httpOnly, expires after 7 days).",
  ]],
  ["What we don't collect", [
    "Your date of birth. It's checked once on our server and thrown away.",
    "Location, contacts, photos or ad IDs.",
    "No trackers, analytics, session recording or third-party scripts. Fonts are served by GhostSlot itself, not Google.",
    "Your timetable and bookings stay in this browser tab in the prototype. They aren't uploaded.",
  ]],
  ["AI features", [
    "When you use CampusAI or AI search, your message and a snapshot of room availability are sent to Google's Gemini API to get an answer. GhostSlot doesn't store these messages.",
    "Voice input uses your browser's speech recognition, which your browser provider may process.",
  ]],
  ["Under-18 students", [
    "Under-18 students can join only after a parent or legal guardian approves through a consent link (DPDP Act 2023, s.9). Until then nothing becomes an account, and an unapproved sign-up is deleted after 48 hours.",
    "We keep the guardian's name, relation and when they approved. Their date of birth is checked once to confirm they're an adult and isn't saved.",
    "No tracking, behavioural scores or ads for under-18s. The guardian can withdraw consent from the same link at any time, which deletes the account.",
    "Faculty and facilities accounts are for adults only.",
  ]],
  ["Why, and for how long", [
    "Only to run your account, find you rooms and, for facilities staff, keep the campus energy and water records.",
    "We keep your account until you delete it. Delete it any time from You → Security & privacy, and it's gone immediately.",
  ]],
  ["Your rights", [
    "You can access, correct and erase your data, and withdraw consent, under India's Digital Personal Data Protection Act, 2023.",
    `Grievances: ${GRIEVANCE_CONTACT}.`,
  ]],
];

export default function PrivacyNotice({ onClose }) {
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 60 }} />
      <div role="dialog" aria-modal="true" aria-labelledby="pn-title" style={{ position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: "min(92vw, 520px)", maxHeight: "86vh", overflowY: "auto", background: "linear-gradient(180deg, #121317, #0D0E11)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 22, zIndex: 61, padding: 22, boxShadow: "0 30px 80px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 11, background: "#16171B", border: "1px solid #2E3138", display: "flex", alignItems: "center", justifyContent: "center" }}><ShieldCheck size={17} color="#D3D7DF" /></div>
            <div id="pn-title" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 18 }}>Privacy notice</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><X size={18} color="#8B8F99" /></button>
        </div>
        <div style={{ fontSize: 12.5, color: "#8B8F99", marginBottom: 14 }}>Short version: we keep the bare minimum, and you can delete it any time.</div>
        {SECTIONS.map(([title, items]) => (
          <div key={title} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.5, color: "#8B8F99", marginBottom: 6 }}>{title.toUpperCase()}</div>
            {items.map((t) => (
              <div key={t} style={{ fontSize: 13, color: "#C9CCD3", lineHeight: 1.5, display: "flex", gap: 8, marginBottom: 4 }}>
                <span style={{ color: "#5F636D" }}>•</span><span>{t}</span>
              </div>
            ))}
          </div>
        ))}
        <button onClick={onClose} style={{ width: "100%", marginTop: 4, background: "linear-gradient(180deg, #ECEEF2, #B9BEC9)", color: "#08090B", border: "none", borderRadius: 12, padding: "12px 14px", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif" }}>Got it</button>
      </div>
    </>
  );
}
