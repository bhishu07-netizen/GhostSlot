// Facilities staff home: what needs fixing right now. Open alerts first,
// then rooms burning power with nobody inside, then the reading form.
// Same /api/twin data as the analytics view; the server checks the role
// on every write.
import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Zap, Droplets, RefreshCw, Activity, IndianRupee, CheckCircle2 } from "lucide-react";
import { api } from "../api";
import { C, Card, Title, Stat, LogReading, AlertList, ManualLog, btn, hhmm, inr, head, mono } from "../Twin";

const SEVERITY = { critical: 0, serious: 1 };

export default function OpsHome({ user, onOpenAnalytics }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api("/twin/overview?days=7")); setErr(null); }
    catch (e) { setErr(e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60 * 1000); return () => clearInterval(t); }, [load]);

  const ack = async (key, status) => {
    setBusyKey(key);
    try { await api("/twin/alerts/ack", { method: "POST", body: { key, status } }); await load(); }
    catch (e) { setErr(e); }
    finally { setBusyKey(null); }
  };

  if (err && !data) {
    return (
      <div style={{ padding: "0 18px" }}>
        <Card style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <AlertTriangle size={18} color={C.warn} style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 600 }}>{err.code === "twin_not_configured" ? "The campus twin isn't connected yet" : "Couldn't load operations"}</div>
            <div style={{ fontSize: 12.5, color: C.sub, marginTop: 4 }}>{err.message}</div>
            <button onClick={load} style={{ ...btn(), marginTop: 8 }}>Try again</button>
          </div>
        </Card>
      </div>
    );
  }
  if (!data) return <div style={{ padding: "0 18px", color: C.sub, fontSize: 13 }}>Loading operations…</div>;

  const todo = data.alerts
    .filter((a) => a.status !== "resolved")
    .sort((a, b) => (SEVERITY[a.severity] ?? 2) - (SEVERITY[b.severity] ?? 2) || (a.status === "open" ? -1 : 1) - (b.status === "open" ? -1 : 1) || b.at.localeCompare(a.at));
  const done = data.alerts.filter((a) => a.status === "resolved");
  const openCount = data.alerts.filter((a) => a.status === "open").length;
  const wasting = data.now.filter((n) => n.state === "wasting");
  const roomById = new Map(data.rooms.map((r) => [r.id, r]));
  const burnPerHour = wasting.reduce((s, n) => s + n.powerKw, 0) * data.tariffInrPerKwh;
  const firstName = user.name.split(" ")[0];

  return (
    <div style={{ padding: "0 18px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: head, fontWeight: 700, fontSize: 18 }}>Shift board · {firstName}</div>
          <div style={{ fontSize: 11.5, color: C.sub }}>{user.department ? `${user.department} team · ` : ""}updated {hhmm(data.generatedAt)} IST · refreshes every minute</div>
        </div>
        <button onClick={load} aria-label="Refresh" style={btn()}><RefreshCw size={13} className={loading ? "gs-spin" : ""} /> Refresh</button>
      </div>
      <div role="note" style={{ fontSize: 11.5, color: C.warn, background: "rgba(245,181,68,0.08)", border: "1px solid rgba(245,181,68,0.25)", borderRadius: 12, padding: "8px 10px" }}>
        <b>Simulated meters.</b> Readings come from the simulator until CU's meters are connected. Anything you log below replaces the simulated value for that slot.
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <Stat value={openCount} label="alerts waiting for you" tone={openCount ? C.bad : C.good} />
        <Stat value={wasting.length} label="rooms empty but powered now" tone={wasting.length ? C.bad : C.good} />
        <Stat value={inr(burnPerHour)} label="being wasted per hour right now" />
        <Stat value={data.water.episodes.length} label="water leaks/spikes this week" tone={data.water.episodes.length ? C.warn : C.good} />
      </div>

      <Card>
        <Title icon={AlertTriangle} sub="Most serious first. Acknowledge when someone's on it, resolve when it's fixed.">To do</Title>
        <AlertList alerts={todo} canManage={data.canManageAlerts} busyKey={busyKey} onAck={ack} empty="All clear. Nothing waiting." />
        {done.length > 0 && (
          <button onClick={() => setShowDone((s) => !s)} style={{ ...btn(), marginTop: 10 }}>
            <CheckCircle2 size={12} /> {showDone ? "Hide" : "Show"} {done.length} resolved
          </button>
        )}
        {showDone && <div style={{ marginTop: 8 }}><AlertList alerts={done} canManage={false} onAck={() => {}} /></div>}
      </Card>

      <Card>
        <Title icon={Zap} sub="Nobody inside, but lights, fans or AC are still drawing power. Send the block attendant.">Switch these off</Title>
        {wasting.length === 0 && <div style={{ fontSize: 12.5, color: C.sub }}>No empty room is drawing power right now.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {wasting.sort((a, b) => b.powerKw - a.powerKw).map((n) => {
            const r = roomById.get(n.roomId);
            return (
              <div key={n.roomId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: "rgba(196,181,253,0.03)", borderRadius: 10, padding: "8px 10px", borderLeft: `3px solid ${C.bad}` }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{n.name}</div>
                  <div style={{ fontSize: 11, color: C.sub }}>{r?.block || ""} · since the {hhmm(n.ts)} reading</div>
                </div>
                <div style={{ textAlign: "right", fontFamily: mono, fontSize: 11.5 }}>
                  <div>{n.powerKw.toFixed(2)} kW</div>
                  <div style={{ color: C.bad }}><IndianRupee size={10} style={{ verticalAlign: -1 }} />{Math.round(n.powerKw * data.tariffInrPerKwh)}/hr</div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <LogReading rooms={data.rooms} buildings={data.buildings} onLogged={load} />
      <ManualLog items={data.manualLog} />

      <button onClick={onOpenAnalytics} style={{ ...btn(), justifyContent: "center", padding: "10px 12px" }}>
        <Activity size={14} /> Full analytics: utilisation heatmap, energy trend, water graphs <Droplets size={13} />
      </button>
    </div>
  );
}
