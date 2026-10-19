import React, { useEffect, useMemo, useState } from "react";
import {
  User as UserIcon, Contact2, Lock, Eye, EyeOff, ShieldCheck, CalendarDays, ServerCog,
  EyeOff as NoEye, Scale, CheckCircle2, ArrowLeft, ArrowRight, LockKeyhole, Loader2, Building2, KeyRound,
} from "lucide-react";
import { ROLE_META, ROLE_ORDER } from "./roles";
import { api } from "../api";
import { BrandMark, Wordmark } from "../brand/BrandMark";
import PrivacyNotice from "./PrivacyNotice";

// ── SkillTwin palette ───────────────────────────────────────────────────────
const C = {
  bg: "#050506", card: "#0E0F12", raised: "#16171B", line: "rgba(255,255,255,0.07)", line2: "#2E3138",
  text: "#F4F5F7", sub: "#8B8F99", muted: "#5F636D", silver: "#D3D7DF", ink: "#08090B",
  green: "#3DDC97", amber: "#F5B544", red: "#FF8B8B",
};
const silverBtn = {
  background: "linear-gradient(180deg, #ECEEF2, #B9BEC9)", color: C.ink, border: "none", borderRadius: 12,
  padding: "12px 14px", fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", fontSize: 14.5, cursor: "pointer",
  boxShadow: "0 1px 0 rgba(255,255,255,.5) inset, 0 6px 18px rgba(0,0,0,.35)",
  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
};
const ghostBtn = { background: C.raised, color: C.text, border: `1px solid ${C.line2}`, borderRadius: 12, padding: "12px 14px", fontWeight: 600, fontSize: 13.5, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 };
const inputStyle = { width: "100%", background: "#0A0B0D", border: `1px solid ${C.line2}`, borderRadius: 12, padding: "12px 12px 12px 36px", color: C.text, fontSize: 13.5, outline: "none" };
const selectStyle = { flex: 1, minWidth: 0, background: "#0A0B0D", border: `1px solid ${C.line2}`, borderRadius: 12, padding: "12px 10px", color: C.text, fontSize: 13.5, outline: "none", appearance: "auto" };

// Same rules the server enforces (server/security.js) — checked here only
// to give instant feedback; the server is the authority.
const ROLL_RE = /^[A-Za-z0-9]{6,15}$/;
const NAME_RE = /^[\p{L}][\p{L} .'-]{1,59}$/u;
const COMMON = ["password", "password1", "password123", "12345678", "123456789", "qwerty123", "iloveyou", "11111111", "abcd1234", "admin123", "test1234", "ghostslot", "chandigarh"];

function pwChecks(pw, roll, name) {
  const lower = pw.toLowerCase();
  const first = (name || "").trim().toLowerCase().split(" ")[0];
  return [
    { ok: pw.length >= 8, label: "8+ characters" },
    { ok: pw.length > 0 && !COMMON.includes(lower), label: "Not a common password" },
    { ok: pw.length > 0 && !(roll && lower.includes(roll.toLowerCase())) && !(first.length >= 3 && lower.includes(first)), label: "No name or ID inside" },
    { ok: /[a-z]/i.test(pw) && /[^a-z]/i.test(pw), label: "Mix letters with numbers or symbols" },
  ];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function Field({ icon: Icon, children }) {
  return (
    <div style={{ position: "relative" }}>
      <Icon size={15} color={C.muted} style={{ position: "absolute", left: 12, top: 14, pointerEvents: "none" }} />
      {children}
    </div>
  );
}

function ErrorBox({ children }) {
  if (!children) return null;
  return <div role="alert" style={{ fontSize: 12.5, color: C.red, background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.2)", borderRadius: 10, padding: "8px 10px" }}>{children}</div>;
}

function Stepper({ step }) {
  const steps = ["You", "Age check", "Secure"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16 }} aria-label={`Step ${step} of 3`}>
      {steps.map((s, i) => {
        const n = i + 1;
        const done = n < step, active = n === step;
        return (
          <React.Fragment key={s}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <div style={{ width: 22, height: 22, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700,
                background: active ? "linear-gradient(180deg, #ECEEF2, #B9BEC9)" : done ? "rgba(61,220,151,0.14)" : C.raised,
                color: active ? C.ink : done ? C.green : C.sub, border: active ? "none" : `1px solid ${done ? "rgba(61,220,151,0.35)" : C.line2}` }}>
                {done ? "✓" : n}
              </div>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: active ? C.text : C.sub }}>{s}</span>
            </div>
            {i < steps.length - 1 && <div style={{ flex: 1, height: 1, background: done ? "rgba(61,220,151,0.35)" : C.line2 }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function RolePicker({ role, setRole }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.5, color: C.sub, marginBottom: 6 }}>I AM</div>
      <div role="radiogroup" aria-label="Account type" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        {ROLE_ORDER.map((id) => {
          const m = ROLE_META[id]; const Icon = m.icon; const on = role === id;
          return (
            <button key={id} role="radio" aria-checked={on} onClick={() => setRole(id)}
              style={{ background: on ? "rgba(255,255,255,0.09)" : C.card, border: `1px solid ${on ? "rgba(211,215,223,0.45)" : C.line}`, borderRadius: 12, padding: "10px 6px",
                color: on ? C.text : C.sub, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 700 }}>
              <Icon size={16} color={on ? C.silver : C.muted} />{m.label}
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 6, textAlign: "center" }}>{ROLE_META[role].can}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The age gate. Neutral: it never says what the cut-off is before you
// answer, and nothing is pre-selected. The server decides.
// ─────────────────────────────────────────────────────────────────────────────
function AgeGate({ role, onVerified, onBlocked, onBack }) {
  const [d, setD] = useState("");
  const [m, setM] = useState("");
  const [y, setY] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);
  const [minor, setMinor] = useState(false);
  const thisYear = new Date().getFullYear();
  const years = useMemo(() => Array.from({ length: 101 }, (_, i) => thisYear - i), [thisYear]);

  async function verify() {
    setError("");
    if (!d || !m || !y) { setError("Pick your day, month and year of birth."); return; }
    const dob = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    setBusy(true);
    try {
      const res = await api("/auth/age-check", { method: "POST", body: { dob, role } });
      setVerified(true);
      setMinor(!!res.minor);
      setTimeout(() => onVerified(res.ageToken, !!res.minor), res.minor ? 1600 : 650);
    } catch (e) {
      if (e.code === "under_age" || e.code === "age_gate_locked") onBlocked(e.data?.until);
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const promises = [
    { icon: ServerCog, t: "Checked on our server", s: "not just in your browser" },
    { icon: NoEye, t: "Birth date never saved", s: "used once, then discarded" },
    { icon: Scale, t: "DPDP Act 2023", s: "India's data-protection law" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ position: "relative", overflow: "hidden", background: "linear-gradient(180deg, #17181D, #0E0F12)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 18, padding: 16, boxShadow: "0 1px 0 rgba(255,255,255,.05) inset, 0 0 60px rgba(200,205,220,0.07)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 14, background: verified ? "rgba(61,220,151,0.14)" : "linear-gradient(180deg, #ECEEF2, #B9BEC9)", border: verified ? "1px solid rgba(61,220,151,0.4)" : "none", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 250ms" }}>
            {verified ? <CheckCircle2 size={22} color={C.green} /> : <ShieldCheck size={22} color={C.ink} />}
          </div>
          <div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 17 }}>{verified ? (minor ? "Parent or guardian approval needed" : "Age verified") : "Quick age check"}</div>
            <div style={{ fontSize: 12, color: C.sub, marginTop: 1 }}>{verified ? (minor ? "You're under 18, so a parent or guardian has to approve your account. You'll get a link to send them." : "You're good to go. Your birth date has already been discarded.") : "Your date of birth confirms you can make an account."}</div>
          </div>
        </div>

        {!verified && (
          <>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.5, color: C.sub, marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
              <CalendarDays size={12} /> DATE OF BIRTH
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <select aria-label="Day of birth" value={d} onChange={(e) => setD(e.target.value)} style={{ ...selectStyle, flex: 0.8 }}>
                <option value="">Day</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <select aria-label="Month of birth" value={m} onChange={(e) => setM(e.target.value)} style={{ ...selectStyle, flex: 1.4 }}>
                <option value="">Month</option>
                {MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
              </select>
              <select aria-label="Year of birth" value={y} onChange={(e) => setY(e.target.value)} style={{ ...selectStyle, flex: 1 }}>
                <option value="">Year</option>
                {years.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 12 }}>
          {promises.map(({ icon: Icon, t, s }) => (
            <div key={t} style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${C.line}`, borderRadius: 12, padding: "8px 8px" }}>
              <Icon size={14} color={C.silver} />
              <div style={{ fontSize: 11, fontWeight: 700, marginTop: 4, lineHeight: 1.25 }}>{t}</div>
              <div style={{ fontSize: 10, color: C.sub, marginTop: 2, lineHeight: 1.3 }}>{s}</div>
            </div>
          ))}
        </div>
      </div>

      <ErrorBox>{error}</ErrorBox>

      {!verified && (
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onBack} style={{ ...ghostBtn, flex: "0 0 auto", padding: "12px 14px" }} aria-label="Back"><ArrowLeft size={15} /></button>
          <button onClick={verify} disabled={busy} style={{ ...silverBtn, flex: 1, opacity: busy ? 0.7 : 1 }}>
            {busy ? <Loader2 size={15} className="gs-spin" /> : <ShieldCheck size={15} />} Verify age
          </button>
        </div>
      )}
    </div>
  );
}

// After an under-18 student signs up: the link to send a parent/guardian.
function GuardianPending({ pending, onDone }) {
  const [copied, setCopied] = useState(false);
  const until = new Date(pending.expiresAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const msg = `Hi! I'm signing up for GhostSlot, the CU campus app. I'm under 18, so it needs your approval. Please open this link: ${pending.link}`;
  async function copy() {
    try { await navigator.clipboard.writeText(pending.link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
  }
  async function share() {
    if (navigator.share) { try { await navigator.share({ title: "GhostSlot parent approval", text: msg }); } catch { /* cancelled */ } }
    else copy();
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ background: "linear-gradient(180deg, #17181D, #0E0F12)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 18, padding: 18 }}>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 18 }}>Almost there: ask a parent or guardian</div>
        <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.55, marginTop: 6 }}>
          Send them this link. They'll see what GhostSlot stores, confirm they're your parent or guardian, and approve. Then log in with your roll number and password.
        </div>
        <div style={{ marginTop: 12, background: "#0A0B0D", border: `1px solid ${C.line2}`, borderRadius: 12, padding: "10px 12px", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, wordBreak: "break-all", color: C.silver }}>{pending.link}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={share} style={{ ...silverBtn, flex: 1, padding: "10px 12px", fontSize: 13.5 }}>Send to parent</button>
          <button onClick={copy} style={{ ...ghostBtn, flex: 1, padding: "10px 12px" }}>{copied ? "Copied ✓" : "Copy link"}</button>
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 10 }}>The link works until {until} IST. If nobody approves by then, your sign-up is deleted. Keep this link private: it's only for your parent or guardian.</div>
      </div>
      <button onClick={onDone} style={ghostBtn}><ArrowLeft size={15} /> Back to login</button>
    </div>
  );
}

function AgeBlocked({ until, onDone }) {
  const when = until ? new Date(until).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ background: "linear-gradient(180deg, #17181D, #0E0F12)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 18, padding: 18, textAlign: "center" }}>
        <div style={{ width: 52, height: 52, borderRadius: 16, margin: "0 auto 10px", background: C.raised, border: `1px solid ${C.line2}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <LockKeyhole size={24} color={C.silver} />
        </div>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 18 }}>We can't create an account for you yet</div>
        <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.55, marginTop: 8 }}>
          Faculty and facilities accounts are for people aged <b style={{ color: C.text }}>18 and over</b>. If you're an under-18 <b style={{ color: C.text }}>student</b>, sign up as a Student: a parent or guardian approves your account, as India's Digital Personal Data Protection Act, 2023 requires.
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12, fontSize: 11.5, color: C.green, background: "rgba(61,220,151,0.10)", border: "1px solid rgba(61,220,151,0.25)", borderRadius: 999, padding: "5px 10px" }}>
          <CheckCircle2 size={12} /> Nothing you entered was saved
        </div>
        {when && <div style={{ fontSize: 11, color: C.muted, marginTop: 10 }}>Sign-up is paused on this device until {when}.</div>}
      </div>
      <button onClick={onDone} style={ghostBtn}><ArrowLeft size={15} /> Back to login</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState("login");
  const [role, setRoleState] = useState("student");
  const [department, setDepartment] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const meta = ROLE_META[role];
  const setRole = (r) => { setRoleState(r); setDepartment(""); setAccessCode(""); setError(""); if (mode === "signup") setStep(1); };
  const [step, setStep] = useState(1);
  const [showPass, setShowPass] = useState(false);
  const [roll, setRoll] = useState("");
  const [name, setName] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [consent, setConsent] = useState(false);
  const [ageToken, setAgeToken] = useState(null);
  const [isMinor, setIsMinor] = useState(false);
  const [pending, setPending] = useState(null); // { link, expiresAt } after an under-18 sign-up
  const [blockedUntil, setBlockedUntil] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState(null);
  const [showPrivacy, setShowPrivacy] = useState(false);

  useEffect(() => {
    api("/auth/config").then((c) => {
      setConfig(c);
      if (c?.ageGate?.locked) setBlockedUntil(c.ageGate.until);
    }).catch((e) => setError(e.message));
  }, []);

  function switchMode(next) {
    setMode(next); setError(""); setStep(1); setPass(""); setPass2("");
  }

  async function login() {
    setError("");
    if (!roll.trim() || !pass) { setError(`Enter your ${meta.idLabel} and password.`); return; }
    setBusy(true);
    try {
      const { user } = await api("/auth/login", { method: "POST", body: { role, roll: roll.trim(), password: pass } });
      onAuthed(user, "login");
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  function nextFromDetails() {
    setError("");
    if (!NAME_RE.test(name.trim())) { setError("You do have a name, right? Letters only, 2–60 characters."); return; }
    if (!ROLL_RE.test(roll.trim())) { setError(`That ${meta.idLabel} looks made up. 6–15 letters/numbers, like ${meta.idExample}.`); return; }
    if (meta.departments && !meta.departments.includes(department)) { setError(`Pick your ${meta.deptLabel.toLowerCase()}.`); return; }
    if (role === "facilities" && !accessCode.trim()) { setError("Enter the facilities access code from the estate office."); return; }
    setStep(2);
  }

  const checks = pwChecks(pass, roll.trim(), name);
  const strong = checks.every((c) => c.ok);

  async function createAccount() {
    setError("");
    if (!strong) { setError("Your password needs every tick below."); return; }
    if (pass !== pass2) { setError("Passwords don't match. Focus."); return; }
    if (!consent) { setError("Please read and accept the privacy notice."); return; }
    setBusy(true);
    try {
      const res = await api("/auth/signup", { method: "POST", body: { role, department: meta.departments ? department : undefined, accessCode: role === "facilities" ? accessCode.trim() : undefined, name: name.trim(), roll: roll.trim(), password: pass, consent: true, ageToken } });
      if (res.pending) { setPending({ link: window.location.origin + res.guardianPath, expiresAt: res.expiresAt }); return; }
      onAuthed(res.user, "signup");
    } catch (e) {
      if (e.code === "age_check_required") { setAgeToken(null); setStep(2); }
      if (e.code === "age_gate_locked") { setBlockedUntil(Date.now()); }
      if (["roll_taken", "invalid_roll", "invalid_name", "invalid_department", "bad_access_code", "facilities_signup_closed", "invalid_role"].includes(e.code)) setStep(1);
      setError(e.message);
    } finally { setBusy(false); }
  }

  const blocked = mode === "signup" && blockedUntil;

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", minHeight: "100vh", color: C.text, background: "radial-gradient(640px 420px at 50% 18%, rgba(190,196,212,.12), transparent 65%), #050506" }}>
      <style>{`
        * { box-sizing: border-box; }
        input::placeholder { color: #5F636D; }
        select option { background: #0E0F12; color: #F4F5F7; }
        input:focus, select:focus { border-color: #6B707C !important; box-shadow: 0 0 0 3px rgba(211,215,223,.10); }
        @keyframes gs-spin { to { transform: rotate(360deg); } }
        .gs-spin { animation: gs-spin 0.9s linear infinite; }
      `}</style>
      <div style={{ maxWidth: 440, margin: "0 auto", display: "flex", flexDirection: "column", justifyContent: "center", minHeight: "100vh", padding: "28px 22px" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 24 }}>
          <BrandMark size={64} glow />
          <div style={{ marginTop: 12 }}><Wordmark size={28} /></div>
          <div style={{ fontSize: 12.5, color: C.sub, marginTop: 6, textAlign: "center" }}>For CU students, faculty and facilities staff. Random uncles still need not apply.</div>
        </div>

        <div role="tablist" style={{ display: "flex", gap: 6, marginBottom: 18, background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 4 }}>
          {[["login", "Login"], ["signup", "Sign up"]].map(([id, label]) => (
            <button key={id} role="tab" aria-selected={mode === id} onClick={() => switchMode(id)} style={{ flex: 1, background: mode === id ? "rgba(255,255,255,0.09)" : "transparent", color: mode === id ? C.text : C.sub, border: "none", borderRadius: 10, padding: "10px 0", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{label}</button>
          ))}
        </div>

        {!(mode === "signup" && (blocked || pending)) && !(mode === "signup" && step > 1) && <div style={{ marginBottom: 14 }}><RolePicker role={role} setRole={setRole} /></div>}

        {mode === "login" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Field icon={Contact2}><input aria-label={meta.idLabel} autoComplete="username" value={roll} onChange={(e) => setRoll(e.target.value)} placeholder={`${meta.idLabel} (e.g. ${meta.idExample})`} style={inputStyle} maxLength={15} /></Field>
            <Field icon={Lock}>
              <input autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()} type={showPass ? "text" : "password"} placeholder="password" style={{ ...inputStyle, paddingRight: 38 }} maxLength={128} />
              <button onClick={() => setShowPass((s) => !s)} aria-label={showPass ? "Hide password" : "Show password"} style={{ position: "absolute", right: 10, top: 11, background: "none", border: "none", cursor: "pointer" }}>{showPass ? <EyeOff size={15} color={C.muted} /> : <Eye size={15} color={C.muted} />}</button>
            </Field>
            <ErrorBox>{error}</ErrorBox>
            <button onClick={login} disabled={busy} style={{ ...silverBtn, marginTop: 4, opacity: busy ? 0.7 : 1 }}>{busy ? <Loader2 size={15} className="gs-spin" /> : null} Log in</button>
            {(config?.demos?.[role] || (role === "student" && config?.demo)) && (() => {
              const d = config.demos?.[role] || config.demo;
              return (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, marginTop: 2 }}>
                  <div style={{ fontSize: 11, color: "#6B6F79", textAlign: "center", fontFamily: "'JetBrains Mono', monospace" }}>
                    {meta.label.toLowerCase()} demo → {d.roll} · {d.password}
                  </div>
                  <button type="button" onClick={() => { setRoll(d.roll); setPass(d.password); }} style={{ background: "none", border: `1px solid ${C.line2}`, color: C.sub, borderRadius: 999, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}>Fill {meta.label.toLowerCase()} demo</button>
                </div>
              );
            })()}
          </div>
        )}

        {mode === "signup" && blocked && <AgeBlocked until={blockedUntil} onDone={() => switchMode("login")} />}

        {mode === "signup" && !blocked && pending && <GuardianPending pending={pending} onDone={() => { setPending(null); switchMode("login"); }} />}

        {mode === "signup" && !blocked && !pending && (
          <div>
            <Stepper step={step} />
            {step === 1 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Field icon={UserIcon}><input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="full name" style={inputStyle} maxLength={60} /></Field>
                <Field icon={Contact2}><input aria-label={meta.idLabel} autoComplete="username" value={roll} onChange={(e) => setRoll(e.target.value)} onKeyDown={(e) => e.key === "Enter" && nextFromDetails()} placeholder={`${meta.idLabel} (e.g. ${meta.idExample})`} style={inputStyle} maxLength={15} /></Field>
                {meta.departments && (
                  <Field icon={Building2}>
                    <select aria-label={meta.deptLabel} value={department} onChange={(e) => setDepartment(e.target.value)} style={{ ...selectStyle, width: "100%", paddingLeft: 36 }}>
                      <option value="">{meta.deptLabel}</option>
                      {meta.departments.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </Field>
                )}
                {role === "facilities" && (config && !config.facilitiesSignupOpen ? (
                  <div style={{ fontSize: 12, color: C.amber, background: "rgba(245,181,68,0.08)", border: "1px solid rgba(245,181,68,0.25)", borderRadius: 10, padding: "8px 10px" }}>
                    Facilities sign-up is closed right now. Ask the estate office to set up your account, or use the facilities demo on the Login tab.
                  </div>
                ) : (
                  <>
                    <Field icon={KeyRound}><input aria-label="Facilities access code" autoComplete="off" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} placeholder="facilities access code (from the estate office)" style={inputStyle} maxLength={64} /></Field>
                    <div style={{ fontSize: 11, color: C.muted }}>Facilities accounts can change campus data, so they need a code from the estate office.</div>
                  </>
                ))}
                <ErrorBox>{error}</ErrorBox>
                <button onClick={nextFromDetails} style={{ ...silverBtn, marginTop: 4 }}>Continue <ArrowRight size={15} /></button>
              </div>
            )}
            {step === 2 && (
              <AgeGate
                role={role}
                onVerified={(tok, minor) => { setAgeToken(tok); setIsMinor(minor); setError(""); setStep(3); }}
                onBlocked={(until) => setBlockedUntil(until || Date.now() + 24 * 3600 * 1000)}
                onBack={() => setStep(1)}
              />
            )}
            {step === 2 && error && <div style={{ marginTop: 10 }}><ErrorBox>{error}</ErrorBox></div>}
            {step === 3 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {isMinor ? (
                  <div style={{ fontSize: 12, color: C.amber, background: "rgba(245,181,68,0.08)", border: "1px solid rgba(245,181,68,0.25)", borderRadius: 10, padding: "8px 10px", lineHeight: 1.45 }}>
                    <b>Under 18:</b> set your password now. Your account starts working once a parent or guardian approves it (you'll get the link next). Birth date discarded.
                  </div>
                ) : (
                  <div style={{ display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: 6, fontSize: 11.5, color: C.green, background: "rgba(61,220,151,0.10)", border: "1px solid rgba(61,220,151,0.25)", borderRadius: 999, padding: "5px 10px" }}>
                    <ShieldCheck size={12} /> Age verified · birth date discarded
                  </div>
                )}
                <Field icon={Lock}>
                  <input autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} type={showPass ? "text" : "password"} placeholder="create a password" style={{ ...inputStyle, paddingRight: 38 }} maxLength={128} />
                  <button onClick={() => setShowPass((s) => !s)} aria-label={showPass ? "Hide password" : "Show password"} style={{ position: "absolute", right: 10, top: 11, background: "none", border: "none", cursor: "pointer" }}>{showPass ? <EyeOff size={15} color={C.muted} /> : <Eye size={15} color={C.muted} />}</button>
                </Field>
                <Field icon={Lock}><input autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} type={showPass ? "text" : "password"} placeholder="confirm password" style={inputStyle} maxLength={128} /></Field>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {checks.map((c) => (
                    <div key={c.label} style={{ fontSize: 11.5, color: c.ok ? C.green : C.sub, display: "flex", alignItems: "center", gap: 5 }}>
                      <CheckCircle2 size={12} style={{ opacity: c.ok ? 1 : 0.35 }} /> {c.label}
                    </div>
                  ))}
                </div>
                <label style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 12.5, color: C.sub, lineHeight: 1.45, marginTop: 4, cursor: "pointer" }}>
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 2, accentColor: "#D3D7DF" }} />
                  <span>I've read the <button type="button" onClick={() => setShowPrivacy(true)} style={{ background: "none", border: "none", padding: 0, color: C.text, textDecoration: "underline", cursor: "pointer", fontSize: 12.5 }}>privacy notice</button> and agree to GhostSlot using my name, {meta.idLabel}{meta.departments ? ` and ${meta.deptLabel.toLowerCase()}` : ""} to run my account.</span>
                </label>
                <ErrorBox>{error}</ErrorBox>
                <button onClick={createAccount} disabled={busy} style={{ ...silverBtn, marginTop: 4, opacity: busy ? 0.7 : 1 }}>{busy ? <Loader2 size={15} className="gs-spin" /> : null} {isMinor ? "Continue to parent approval" : "Create account"}</button>
              </div>
            )}
          </div>
        )}

        <button onClick={() => setShowPrivacy(true)} style={{ marginTop: 22, background: "none", border: "none", color: C.muted, fontSize: 11.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, alignSelf: "center" }}>
          <ShieldCheck size={12} /> Privacy notice · no trackers · no ads
        </button>
      </div>
      {showPrivacy && <PrivacyNotice onClose={() => setShowPrivacy(false)} />}
    </div>
  );
}
