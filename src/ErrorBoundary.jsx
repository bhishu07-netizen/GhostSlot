import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

// If one screen crashes, show a calm card with a way back instead of a blank
// page. The rest of the app (nav, booking bar) keeps working.
export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("[GhostSlot] screen crashed:", error, info?.componentStack); }
  componentDidUpdate(prev) {
    // Switching tabs clears the error so the next screen gets a fresh try.
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ margin: "0 18px", background: "#120F1E", border: "1px solid rgba(255,107,107,0.3)", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}><AlertTriangle size={16} color="#FF8B8B" /> This screen hit a snag</div>
        <div style={{ fontSize: 12.5, color: "#CFC7EC" }}>Nothing you saved is lost. Try again, or switch tabs.</div>
        <button onClick={() => this.setState({ error: null })} style={{ alignSelf: "flex-start", background: "linear-gradient(180deg, #C4B5FD, #8B5CF6)", color: "#0A0812", border: "none", borderRadius: 10, padding: "8px 12px", fontWeight: 700, fontSize: 12.5, cursor: "pointer", display: "flex", gap: 5, alignItems: "center" }}>
          <RefreshCw size={13} /> Try again
        </button>
      </div>
    );
  }
}
