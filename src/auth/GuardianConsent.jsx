// Parent / guardian consent page for under-18 students (DPDP Act 2023 s.9,
// DPDP Rules 2025 r.10). Opened from the link the student sends:
//   /guardian#<code>
// The code sits after "#", so it never reaches server logs or other sites.
import React, { useEffect, useMemo, useState } from "react";
import { ShieldCheck, CheckCircle2, Loader2, AlertTriangle, Trash2 } from "lucide-react";
import { api } from "../api";
import { BrandMark, Wordmark } from "../brand/BrandMark";

const C = { text: "#F4F1FF", sub: "#A39CC4", muted: "#6A6390", line: "rgba(196,181,253,0.08)", line2: "#322A50", green: "#3DDC97", red: "#FF8B8B", amber: "#F5B544", ink: "#0A0812" };
const input = { width: "100%", background: "#0B0914", border: `1px solid ${C.line2}`, borderRadius: 12, padding: "11px 12px", color: C.text, fontSize: 13.5, outline: "none" };
const primary = { background: "linear-gradient(180deg, #F1ECFF, #A78BFA)", color: C.ink, border: "none", borderRadius: 12, padding: "12px 14px", fontWeight: 700, fontSize: 14.5, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 };
const ghost = { background: "#1A1630", color: C.text, border: `1px solid ${C.line2}`, borderRadius: 12, padding: "10px 12px", fontWeight: 600, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fmt = (ts) => new Date(ts).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const STORED = [
  "Your child's name and student roll number",
  "Their password, stored only as a scrambled hash (nobody can read it)",
  "Your name, whether you're a parent or legal guardian, and when you approved",
  "Not stored: anyone's date of birth, location, contacts or photos",
];
const USED_FOR = [
  "Finding free classrooms and study spaces, and booking them",
  "Viewing the campus energy and water dashboards",
  "AI search and CampusAI chat: their questions go to Google's Gemini API for an answer and aren't saved",
  "No ads, no tracking or behavioural scores for under-18s, no selling or sharing of data",
];

export default function GuardianConsent() {
  const code = useMemo(() => decodeURIComponent(window.location.hash.replace(/^#/, "")), []);
  const [info, setInfo] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [gName, setGName] = useState("");
  const [relation, setRelation] = useState("");
  const [d, setD] = useState(""); const [m, setM] = useState(""); const [y, setY] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null); // "approved" | "withdrawn"
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const thisYear = new Date().getFullYear();
  const years = useMemo(() => Array.from({ length: 93 }, (_, i) => thisYear - 18 - i), [thisYear]);

  useEffect(() => {
    if (!code) { setLoadErr("This consent link is incomplete. Ask your child to send it again."); return; }
    api("/auth/guardian/lookup", { method: "POST", body: { code } }).then(setInfo).catch((e) => setLoadErr(e.message));
  }, [code]);

  async function approve() {
    if (busy) return;
    setErr("");
    if (!gName.trim() || !relation || !d || !m || !y) { setErr("Fill in your name, relation and date of birth."); return; }
    if (!consent) { setErr("Tick the consent box to approve."); return; }
    setBusy(true);
    try {
      const dob = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      await api("/auth/guardian/approve", { method: "POST", body: { code, guardianName: gName.trim(), relation, dob, consent: true } });
      setDone("approved");
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }
  async function withdraw() {
    if (busy) return;
    setErr(""); setBusy(true);
    try { await api("/auth/guardian/withdraw", { method: "POST", body: { code, confirm: true } }); setDone("withdrawn"); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const child = info?.child;
  return (
    <div style={{ fontFamily: "'Inter', sans-serif", minHeight: "100vh", color: C.text, background: "radial-gradient(640px 420px at 50% 10%, rgba(190,196,212,.10), transparent 65%), #07060C" }}>
      <style>{`* { box-sizing: border-box; } input::placeholder { color: #6A6390; } select option { background: #100D1B; color: #F4F1FF; } @keyframes gs-spin { to { transform: rotate(360deg); } } .gs-spin { animation: gs-spin 0.9s linear infinite; }`}</style>
      <main style={{ maxWidth: 520, margin: "0 auto", padding: "28px 20px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BrandMark size={40} /><Wordmark size={22} />
        </div>
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, margin: 0 }}>Parent / guardian consent</h1>

        {loadErr && <Box tone="red"><AlertTriangle size={15} /> {loadErr}</Box>}
        {!loadErr && !info && <div style={{ color: C.sub, fontSize: 13 }}>Loading…</div>}

        {done === "approved" && (
          <Box tone="green"><CheckCircle2 size={16} /> <span>Approved. <b>{child?.name}</b> can now log in. Keep this link: you can come back to it any time to withdraw consent and delete their account.</span></Box>
        )}
        {done === "withdrawn" && <Box tone="green"><CheckCircle2 size={16} /> <span>Done. The account and everything stored with it has been deleted.</span></Box>}

        {info && !done && (
          <>
            <Card>
              <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
                <b>{child.name}</b> (roll number <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{child.roll}</span>) wants to use
                <b> GhostSlot</b>, a student-built campus app at Chandigarh University. Because they're under 18, India's Digital Personal Data Protection Act, 2023 needs your consent first.
              </div>
              {info.status === "pending" && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 8 }}>This request expires on {fmt(info.expiresAt)} IST.</div>}
              {info.status === "approved" && <div style={{ fontSize: 12, color: C.green, marginTop: 8 }}>You approved this on {fmt(info.consentAt)} IST.</div>}
            </Card>

            <Card>
              <List title="What GhostSlot stores" items={STORED} />
              <div style={{ height: 10 }} />
              <List title="What it's used for" items={USED_FOR} />
              <div style={{ fontSize: 12, color: C.sub, marginTop: 10, lineHeight: 1.5 }}>
                You can withdraw consent at any time from this page. That deletes the account immediately. Your child can also delete it themselves.
              </div>
            </Card>

            {info.status === "pending" && (
              <Card>
                <div style={{ fontWeight: 700, marginBottom: 10, display: "flex", gap: 6, alignItems: "center" }}><ShieldCheck size={15} /> Approve</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <input aria-label="Your full name" value={gName} onChange={(e) => setGName(e.target.value)} placeholder="your full name" maxLength={60} style={input} />
                  <select aria-label="Relation" value={relation} onChange={(e) => setRelation(e.target.value)} style={input}>
                    <option value="">I am their…</option>
                    <option value="Parent">Parent</option>
                    <option value="Legal guardian">Legal guardian</option>
                  </select>
                  <div>
                    <div style={{ fontSize: 11, color: C.sub, marginBottom: 6 }}>Your date of birth (to confirm you're an adult; checked once, not saved)</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <select aria-label="Day" value={d} onChange={(e) => setD(e.target.value)} style={{ ...input, flex: 0.8 }}><option value="">Day</option>{Array.from({ length: 31 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}</select>
                      <select aria-label="Month" value={m} onChange={(e) => setM(e.target.value)} style={{ ...input, flex: 1.4 }}><option value="">Month</option>{MONTHS.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}</select>
                      <select aria-label="Year" value={y} onChange={(e) => setY(e.target.value)} style={{ ...input, flex: 1 }}><option value="">Year</option>{years.map((n) => <option key={n} value={n}>{n}</option>)}</select>
                    </div>
                  </div>
                  <label style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 12.5, color: C.sub, lineHeight: 1.45, cursor: "pointer" }}>
                    <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 2 }} />
                    <span>I'm {child.name}'s parent or legal guardian, and I consent to GhostSlot processing their data as described above.</span>
                  </label>
                  {err && <Box tone="red">{err}</Box>}
                  <button onClick={approve} disabled={busy} style={{ ...primary, opacity: busy ? 0.7 : 1 }}>{busy ? <Loader2 size={15} className="gs-spin" /> : <ShieldCheck size={15} />} Approve account</button>
                  <button onClick={withdraw} disabled={busy} style={ghost}>Decline and delete this request</button>
                </div>
              </Card>
            )}

            {info.status === "approved" && (
              <Card>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Withdraw consent</div>
                <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 10 }}>This deletes {child.name}'s GhostSlot account and signs them out everywhere. It can't be undone.</div>
                {err && <div style={{ marginBottom: 8 }}><Box tone="red">{err}</Box></div>}
                {!confirmWithdraw
                  ? <button onClick={() => setConfirmWithdraw(true)} style={{ ...ghost, color: C.red }}><Trash2 size={14} /> Withdraw consent</button>
                  : <button onClick={withdraw} disabled={busy} style={{ ...ghost, background: "#FF6B6B", color: C.ink, border: "none" }}>{busy ? <Loader2 size={14} className="gs-spin" /> : <Trash2 size={14} />} Yes, delete the account</button>}
              </Card>
            )}
          </>
        )}
        <div style={{ fontSize: 11, color: C.muted, textAlign: "center", marginTop: 6 }}>No trackers · no ads · fonts served by GhostSlot</div>
      </main>
    </div>
  );
}

function Card({ children }) {
  return <div style={{ background: "#100D1B", border: `1px solid ${C.line}`, borderRadius: 16, padding: 16 }}>{children}</div>;
}
function List({ title, items }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.5, color: C.sub, marginBottom: 6 }}>{title.toUpperCase()}</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6, color: "#CFC7EC" }}>{items.map((t) => <li key={t}>{t}</li>)}</ul>
    </div>
  );
}
function Box({ tone, children }) {
  const col = tone === "green" ? C.green : C.red;
  return <div role={tone === "red" ? "alert" : "status"} style={{ fontSize: 12.5, color: col, background: `${col}14`, border: `1px solid ${col}40`, borderRadius: 12, padding: "10px 12px", display: "flex", gap: 8, alignItems: "flex-start" }}>{children}</div>;
}
