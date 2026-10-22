import React, { useEffect, useRef, useState } from "react";
import { Sparkles, X, Send, Mic, MicOff, Loader2, MapPin } from "lucide-react";

// Point this at your backend. In dev with a proxy (Vite/CRA) "/api/ai/chat"
// is fine as-is; in prod set VITE_CAMPUSAI_API_URL to the deployed backend.
const API_URL =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_CAMPUSAI_API_URL) ||
  "/api/ai/chat";

const FALLBACK_MESSAGE =
  "CampusAI is temporarily unavailable. You can still use Search and Filters to find a space.";

const SUGGESTED_PROMPTS = [
  { icon: "🔎", text: "Find a study space" },
  { icon: "🧭", text: "Where is the library?" },
  { icon: "📍", text: "Find an available room" },
];

// Browser speech-to-text needs a language hint; Gemini itself detects and
// replies in whatever language the resulting text is in, so this selector
// only steers recognition, not the assistant's reply language.
const SPEECH_LANGS = [
  { code: "en-US", label: "EN" },
  { code: "hi-IN", label: "हि" },
  { code: "pa-IN", label: "ਪਾ" },
];

function getSpeechRecognitionCtor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/**
 * CampusAI — the single centralized AI assistant for the whole app.
 *
 * Props:
 * - buildContext(): () => object
 *     Builds the campus-data snapshot (rooms + live status, day/time,
 *     the student's free windows) to send with each message. The caller
 *     owns this so CampusAI never has its own copy of app state to drift
 *     out of sync — it only ever sees what the app hands it right now.
 * - onViewSpace(roomId): (string) => void
 *     Called when the student taps a "View Space" action button. Wire this
 *     to whatever already shows/filters a room in the existing Find tab —
 *     CampusAI does not implement its own room view.
 */
export default function CampusAI({ buildContext, onViewSpace }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Hey, I'm CampusAI. Ask me to find a space, check what's free right now, or point you to a building — in English, Hindi, or Punjabi.",
      actions: [],
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechLang, setSpeechLang] = useState("en-US");
  const recognitionRef = useRef(null);
  const scrollRef = useRef(null);
  const speechSupported = !!getSpeechRecognitionCtor();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open, loading]);

  // Stop any live recognition if the panel closes, so we never listen
  // in the background.
  useEffect(() => {
    if (!open) recognitionRef.current?.stop?.();
  }, [open]);

  async function send(overrideText) {
    const trimmed = (overrideText ?? input).trim();
    if (!trimmed || loading) return;
    setInput("");
    const nextMessages = [...messages, { role: "user", text: trimmed, actions: [] }];
    setMessages(nextMessages);
    setLoading(true);
    try {
      const history = nextMessages.slice(-8).map((m) => ({ role: m.role, text: m.text }));
      const context = typeof buildContext === "function" ? buildContext() : {};
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, context, history }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      if (!data || typeof data.reply !== "string" || !data.reply.trim()) {
        throw new Error("empty reply");
      }
      setMessages((m) => [...m, { role: "assistant", text: data.reply, actions: data.actions || [] }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: FALLBACK_MESSAGE, actions: [], isFallback: true }]);
    } finally {
      setLoading(false);
    }
  }

  function toggleListening() {
    const SR = getSpeechRecognitionCtor();
    if (!SR) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    // Permission is requested by the browser right here, on tap — never
    // ahead of time, and recognition stops itself after one utterance
    // instead of listening continuously.
    const recognition = new SR();
    recognition.lang = speechLang;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setListening(true);
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) send(transcript);
    };
    recognitionRef.current = recognition;
    recognition.start();
  }

  function handleAction(action) {
    if (action.type === "view_space" && action.roomId && onViewSpace) {
      onViewSpace(action.roomId);
      setOpen(false);
    }
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Ask CampusAI"
          style={{
            position: "fixed",
            right: 16,
            bottom: 96,
            zIndex: 30,
            background: "linear-gradient(180deg, #F1ECFF, #A78BFA)",
            color: "#0A0812",
            border: "none",
            borderRadius: 999,
            padding: "11px 16px",
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontWeight: 700,
            fontSize: 13,
            fontFamily: "'Space Grotesk', sans-serif",
            boxShadow: "0 0 0 1px rgba(255,255,255,.35) inset, 0 10px 30px rgba(139,92,246,0.45)",
            cursor: "pointer",
            maxWidth: "calc(100vw - 32px)",
          }}
        >
          🤖 Ask CampusAI
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="CampusAI chat"
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 40,
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-end",
            background: "rgba(6,6,14,0.55)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 460,
              height: "min(78vh, 640px)",
              background: "#100D1B",
              borderRadius: "20px 20px 0 0",
              display: "flex",
              flexDirection: "column",
              border: "1px solid rgba(196,181,253,0.08)",
              borderBottom: "none",
              overflow: "hidden",
              fontFamily: "'Inter', sans-serif",
              color: "#F4F1FF",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 16px",
                borderBottom: "1px solid rgba(196,181,253,0.07)",
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: "#C4B5FD", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Sparkles size={16} color="#07060C" />
                </div>
                <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 15 }}>CampusAI</div>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer" }}>
                <X size={18} color="#A39CC4" />
              </button>
            </div>

            <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              {messages.map((m, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start", gap: 6 }}>
                  <div
                    style={{
                      maxWidth: "85%",
                      background: m.role === "user" ? "#C4B5FD" : m.isFallback ? "rgba(255,107,107,0.12)" : "#120F1E",
                      color: m.role === "user" ? "#0A0812" : m.isFallback ? "#FF8B8B" : "#F4F1FF",
                      border: m.role === "user" ? "none" : "1px solid rgba(196,181,253,0.07)",
                      borderRadius: 14,
                      padding: "9px 12px",
                      fontSize: 13,
                      lineHeight: 1.45,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {m.text}
                  </div>
                  {m.actions?.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {m.actions.map((a, j) => (
                        <button
                          key={j}
                          onClick={() => handleAction(a)}
                          style={{
                            background: "rgba(167,139,250,0.12)",
                            color: "#E9E3FF",
                            border: "1px solid rgba(167,139,250,0.3)",
                            borderRadius: 999,
                            padding: "6px 11px",
                            fontSize: 11.5,
                            fontWeight: 700,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <MapPin size={11} /> {a.label || "View space"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#A39CC4", fontSize: 12.5 }}>
                  <Loader2 size={13} className="campusai-spin" /> CampusAI is thinking…
                </div>
              )}
            </div>

            {messages.length <= 1 && (
              <div style={{ padding: "0 16px 10px", display: "flex", gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
                {SUGGESTED_PROMPTS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => send(p.text)}
                    style={{ background: "#120F1E", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 999, padding: "7px 11px", fontSize: 11.5, color: "#CFC7EC", cursor: "pointer" }}
                  >
                    {p.icon} {p.text}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, padding: "10px 14px 14px", borderTop: "1px solid rgba(196,181,253,0.07)", flexShrink: 0, alignItems: "center" }}>
              {speechSupported && (
                <select
                  value={speechLang}
                  onChange={(e) => setSpeechLang(e.target.value)}
                  aria-label="Speech language"
                  style={{ background: "#120F1E", color: "#A39CC4", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 10, fontSize: 11, padding: "6px 4px" }}
                >
                  {SPEECH_LANGS.map((l) => (
                    <option key={l.code} value={l.code} style={{ background: "#120F1E" }}>
                      {l.label}
                    </option>
                  ))}
                </select>
              )}
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") send();
                }}
                placeholder="Ask CampusAI anything…"
                style={{ flex: 1, background: "#120F1E", border: "1px solid rgba(196,181,253,0.08)", borderRadius: 12, padding: "10px 12px", color: "#F4F1FF", fontSize: 13, outline: "none" }}
              />
              {speechSupported && (
                <button
                  onClick={toggleListening}
                  aria-label={listening ? "Stop listening" : "Speak"}
                  style={{
                    background: listening ? "#FF6B6B" : "#120F1E",
                    border: "1px solid rgba(196,181,253,0.08)",
                    borderRadius: 12,
                    width: 38,
                    height: 38,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  {listening ? <MicOff size={16} color="#FFFFFF" /> : <Mic size={16} color="#A39CC4" />}
                </button>
              )}
              <button
                onClick={() => send()}
                disabled={loading || !input.trim()}
                aria-label="Send"
                style={{
                  background: "#E9E3FF",
                  border: "none",
                  borderRadius: 12,
                  width: 38,
                  height: 38,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: loading || !input.trim() ? "not-allowed" : "pointer",
                  opacity: loading || !input.trim() ? 0.5 : 1,
                  flexShrink: 0,
                }}
              >
                <Send size={16} color="#07060C" />
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes campusai-spin { to { transform: rotate(360deg); } }
        .campusai-spin { animation: campusai-spin 1s linear infinite; }
      `}</style>
    </>
  );
}
