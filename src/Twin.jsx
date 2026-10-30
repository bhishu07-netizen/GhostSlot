// Campus Twin tab: live room state, utilisation heatmap, energy waste,
// water anomalies, alerts and reallocation suggestions.
// All numbers come from /api/twin (computed in Postgres). The data is
// SIMULATED until CU meters are connected, and the UI says so up front.
import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, LineChart, Line,
} from "recharts";
import { Zap, Droplets, Building2, AlertTriangle, CheckCircle2, RefreshCw, Info, Lightbulb, ClipboardPen, Eye } from "lucide-react";
import { api } from "./api";

export const C = {
  card: "#120F1E", border: "rgba(196,181,253,0.07)", text: "#F4F1FF", sub: "#A39CC4", muted: "#857DA8",
  silver: "#C4B5FD", good: "#3DDC97", warn: "#F5B544", bad: "#FF6B6B", blue: "#5B9BEA",
};
const STATE = {
  occupied: { color: C.blue, label: "In use" },
  free: { color: C.good, label: "Free" },
  wasting: { color: C.bad, label: "Empty but powered" },
};
export const mono = "'JetBrains Mono', monospace";
export const head = "'Space Grotesk', sans-serif";
export const ist = (ts, opts) => new Date(ts).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...opts });
export const hhmm = (ts) => ist(ts, { hour: "2-digit", minute: "2-digit", hour12: false });
const dayLabel = (d) => new Date(d + "T00:00:00+05:30").toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
export const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");

export function Card({ children, style }) {
  return <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 14, ...style }}>{children}</div>;
}
export function Title({ icon: Icon, children, sub }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontFamily: head, fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 7 }}>
        {Icon && <Icon size={15} color={C.silver} />}{children}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: C.sub, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
export function Stat({ value, label, tone }) {
  return (
    <Card style={{ flex: "1 1 140px", padding: 12 }}>
      <div style={{ fontFamily: head, fontWeight: 700, fontSize: 22, color: tone || C.text }}>{value}</div>
      <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>{label}</div>
    </Card>
  );
}
const tooltipStyle = { background: "#07060C", border: "1px solid rgba(196,181,253,0.1)", borderRadius: 10, fontSize: 12 };

// Utilisation colour scale. Sequential, one hue, brightness rises with use, so
// it reads the same way on our dark background: 0% = a faint tint just above
// the card, 100% = bright blue. (Plain alpha on dark made 0% look "darkest",
// which contradicted the label.) 5 even steps so the legend matches exactly.
const HEAT_STEPS = ["#1C2236", "#1F3A63", "#2A5C9A", "#4A86D0", "#8EC1F5"];
const HEAT_EDGES = [0, 20, 40, 60, 80, 100];
function heatStep(v) { const p = Math.max(0, Math.min(100, v)); return Math.min(4, Math.floor(p / 20)); }
function heatFill(v) { return HEAT_STEPS[heatStep(v)]; }
function heatInk(v) { return heatStep(v) >= 3 ? "#0C0A15" : "#E6EDF8"; }
function HeatLegend() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 10.5, color: C.sub, margin: "2px 0 8px" }}>
      <span>in use</span>
      <div style={{ display: "flex", gap: 2 }}>
        {HEAT_STEPS.map((c, i) => (
          <div key={c} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <div style={{ width: 34, height: 10, borderRadius: 3, background: c }} />
            <span style={{ fontFamily: mono, fontSize: 9.5 }}>{HEAT_EDGES[i]}{i === 4 ? "–100%" : `–${HEAT_EDGES[i + 1] - 1}`}</span>
          </div>
        ))}
      </div>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 14, height: 10, borderRadius: 3, border: "1px dashed rgba(196,181,253,0.25)" }} /> no data</span>
    </div>
  );
}

export default function Twin({ showLog = true }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState("A1");
  const [water, setWater] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api(`/twin/overview?days=${days}`)); setErr(null); }
    catch (e) { setErr(e); }
    finally { setLoading(false); }
  }, [days]);

  useEffect(() => { load(); const t = setInterval(load, 60 * 1000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    let live = true;
    api(`/twin/water?building=${encodeURIComponent(building)}`).then((w) => live && setWater(w)).catch(() => live && setWater(null));
    return () => { live = false; };
  }, [building, data?.generatedAt]);

  const ack = async (key, status) => {
    setBusyKey(key);
    try { await api("/twin/alerts/ack", { method: "POST", body: { key, status } }); await load(); }
    catch (e) { setErr(e); }
    finally { setBusyKey(null); }
  };

  const heat = useMemo(() => {
    if (!data) return null;
    const hours = Array.from({ length: 12 }, (_, i) => 8 + i);
    const byRoom = new Map();
    for (const h of data.heatmap) {
      if (!byRoom.has(h.roomId)) byRoom.set(h.roomId, {});
      byRoom.get(h.roomId)[h.hour] = h.utilPct;
    }
    return { hours, rows: data.rooms.map((r) => ({ ...r, cells: hours.map((h) => byRoom.get(r.id)?.[h] ?? null) })) };
  }, [data]);

  const waterSeries = useMemo(() => {
    if (!water || !data) return [];
    const eps = data.water.episodes.filter((e) => e.buildingId === building);
    return water.readings.map((r) => {
      const t = new Date(r.ts).getTime();
      const flagged = eps.some((e) => t >= new Date(e.start).getTime() && t <= new Date(e.end).getTime());
      return { t: hhmm(r.ts), full: ist(r.ts, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }), litres: r.litres, flagged };
    });
  }, [water, data, building]);

  if (err && !data) {
    return (
      <div style={{ padding: "0 18px" }}>
        <Card style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <AlertTriangle size={18} color={C.warn} style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 600 }}>{err.code === "twin_not_configured" ? "The campus twin isn't connected yet" : "Couldn't load the campus twin"}</div>
            <div style={{ fontSize: 12.5, color: C.sub, marginTop: 4 }}>{err.message}</div>
            <button onClick={load} style={btn()}>Try again</button>
          </div>
        </Card>
      </div>
    );
  }
  if (!data) return <div style={{ padding: "0 18px", color: C.sub, fontSize: 13 }}>Loading the campus twin…</div>;

  const wastingNow = data.now.filter((n) => n.state === "wasting");
  const openAlerts = data.alerts.filter((a) => a.status === "open");
  const avgUtil = (() => {
    const v = data.energy.rooms.map((r) => r.classHourUtilPct).filter((x) => x !== null);
    return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : 0;
  })();
  const blocks = [...new Set(data.rooms.map((r) => r.block))];
  const nowById = new Map(data.now.map((n) => [n.roomId, n]));
  const daily = data.energy.daily.map((d) => ({ day: dayLabel(d.day), Used: Math.round(d.totalKwh - d.wastedKwh), Wasted: Math.round(d.wastedKwh) }));

  return (
    <div style={{ padding: "0 18px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: head, fontWeight: 700, fontSize: 18 }}>Campus Digital Twin</div>
          <div style={{ fontSize: 11.5, color: C.sub }}>Updated {hhmm(data.generatedAt)} IST · refreshes every minute</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[7, 14].map((d) => (
            <button key={d} onClick={() => setDays(d)} aria-pressed={days === d} style={btn(days === d)}>{d} days</button>
          ))}
          <button onClick={load} aria-label="Refresh" style={btn()}><RefreshCw size={13} className={loading ? "gs-spin" : ""} /></button>
        </div>
      </div>
      <div role="note" style={{ fontSize: 11.5, color: C.warn, background: "rgba(245,181,68,0.08)", border: "1px solid rgba(245,181,68,0.25)", borderRadius: 12, padding: "8px 10px", display: "flex", gap: 6 }}>
        <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
        <span><b>Simulated data.</b> CU's meters and sensors aren't connected yet, so readings come from a simulator with realistic class timings, waste and leaks. ₹ uses an assumed tariff of ₹{data.tariffInrPerKwh}/kWh.</span>
      </div>

      {data.canManageAlerts ? (
        showLog && <LogReading rooms={data.rooms} buildings={data.buildings} onLogged={load} />
      ) : (
        <div role="note" style={{ fontSize: 11.5, color: C.sub, background: "rgba(196,181,253,0.03)", border: `1px solid ${C.border}`, borderRadius: 12, padding: "8px 10px", display: "flex", gap: 6 }}>
          <Eye size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span><b style={{ color: C.text }}>View only.</b> Energy and water readings are logged, and alerts handled, by facilities staff.</span>
        </div>
      )}
      {showLog && <ManualLog items={data.manualLog} />}

      {/* KPIs */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <Stat value={`${data.energy.wastedPct}%`} label={`of energy wasted in empty rooms (${data.energy.wastedKwh} kWh, last ${days} days)`} tone={C.bad} />
        <Stat value={inr(data.energy.wastedInr)} label={`estimated cost of that waste`} />
        <Stat value={wastingNow.length} label="rooms empty but powered right now" tone={wastingNow.length ? C.bad : C.good} />
        <Stat value={`${avgUtil}%`} label="average room use in class hours" />
      </div>

      {/* Live twin */}
      <Card>
        <Title icon={Building2} sub="Every tracked room, from its latest 15-minute reading.">Live campus view</Title>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
          {Object.entries(STATE).map(([k, s]) => (
            <span key={k} style={{ fontSize: 11, color: C.sub, display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />{s.label}
            </span>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
          {blocks.map((b) => (
            <div key={b} style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 10 }}>
              <div style={{ fontSize: 11, fontFamily: mono, color: C.silver, marginBottom: 8 }}>{b.toUpperCase()}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {data.rooms.filter((r) => r.block === b).map((r) => {
                  const n = nowById.get(r.id);
                  const s = STATE[n?.state] || { color: C.muted, label: "No data" };
                  return (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(196,181,253,0.03)", borderRadius: 8, padding: "6px 8px", borderLeft: `3px solid ${s.color}` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                        <div style={{ fontSize: 10.5, color: C.sub }}>
                          {s.label}{n ? ` · ${n.occupants ? `${n.occupants}/${r.capacity} people · ` : ""}${n.powerKw.toFixed(1)} kW` : ""}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Alerts */}
      <Card>
        <Title icon={AlertTriangle} sub={`${openAlerts.length} open · ${data.canManageAlerts ? "you can acknowledge or resolve each one (facilities access)." : "facilities staff acknowledge and resolve these."}`}>Alerts</Title>
        <AlertList alerts={data.alerts} canManage={data.canManageAlerts} busyKey={busyKey} onAck={ack} />
      </Card>

      {/* Utilisation heatmap */}
      <Card>
        <Title sub={`Share of each weekday hour a room was in use, last ${days} days. Brighter = busier; 0 = empty all period.`}>Classroom utilisation</Title>
        <HeatLegend />
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 3, fontSize: 10.5, minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", color: C.sub, fontWeight: 500, paddingRight: 6 }}>Room</th>
                {heat.hours.map((h) => <th key={h} style={{ color: C.sub, fontWeight: 500, fontFamily: mono }}>{String(h).padStart(2, "0")}</th>)}
              </tr>
            </thead>
            <tbody>
              {heat.rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap", paddingRight: 6, color: "#CFC7EC" }}>{r.name}</td>
                  {r.cells.map((v, i) => (
                    <td key={i} title={`${r.name}, ${heat.hours[i]}:00 — ${v === null ? "no data" : v + "% in use"}`}
                      style={{ width: 36, height: 24, textAlign: "center", borderRadius: 4, fontFamily: mono,
                        background: v === null ? "transparent" : heatFill(v),
                        border: v === null ? "1px dashed rgba(196,181,253,0.12)" : "1px solid transparent",
                        color: v === null ? C.muted : heatInk(v) }}>
                      {v === null ? "–" : Math.round(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Suggestions */}
      {data.suggestions.length > 0 && (
        <Card>
          <Title icon={Lightbulb} sub="Rooms that sit mostly empty during class hours.">Use what's already built</Title>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.suggestions.map((s) => (
              <div key={s.roomId} style={{ fontSize: 12.5, color: "#CFC7EC", padding: "8px 10px", background: "rgba(196,181,253,0.03)", borderRadius: 10 }}>{s.text}</div>
            ))}
          </div>
        </Card>
      )}

      {/* Energy */}
      <Card>
        <Title icon={Zap} sub="kWh per day: used while people were in the room vs drawn by empty rooms.">Energy waste</Title>
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={daily} margin={{ top: 4, right: 6, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="rgba(196,181,253,0.05)" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(196,181,253,0.04)" }} formatter={(v) => `${v} kWh`} />
              <Legend wrapperStyle={{ fontSize: 11, color: C.sub }} />
              <Bar dataKey="Used" stackId="e" fill={C.blue} stroke="#120F1E" strokeWidth={2} />
              <Bar dataKey="Wasted" stackId="e" fill={C.bad} stroke="#120F1E" strokeWidth={2} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ fontSize: 11.5, color: C.sub, margin: "12px 0 6px" }}>Biggest wasters (last {days} days)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {data.energy.rooms.slice(0, 5).map((r) => {
            const max = data.energy.rooms[0].wastedKwh || 1;
            return (
              <div key={r.roomId} style={{ display: "grid", gridTemplateColumns: "minmax(90px,130px) 1fr auto", alignItems: "center", gap: 8, fontSize: 12 }}>
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#CFC7EC" }}>{r.name}</span>
                <span style={{ height: 8, borderRadius: 4, background: "rgba(196,181,253,0.05)" }}>
                  <span style={{ display: "block", height: 8, borderRadius: 4, width: `${(r.wastedKwh / max) * 100}%`, background: C.bad }} />
                </span>
                <span style={{ fontFamily: mono, fontSize: 11, textAlign: "right" }}>{Math.round(r.wastedKwh)} kWh · {inr(r.wastedInr)}</span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Water */}
      <Card>
        <Title icon={Droplets} sub="Litres per 15 minutes, last 48 hours. Red dots = abnormal for that time of day.">Water use</Title>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {data.buildings.map((b) => <button key={b.id} onClick={() => setBuilding(b.id)} aria-pressed={building === b.id} style={btn(building === b.id)}>{b.name}</button>)}
        </div>
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={waterSeries} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid stroke="rgba(196,181,253,0.05)" vertical={false} />
              <XAxis dataKey="t" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} interval={23} />
              <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(_, p) => p?.[0]?.payload?.full || ""} formatter={(v, _n, p) => [`${v} L${p.payload.flagged ? " · abnormal" : ""}`, "Water"]} />
              <Line type="monotone" dataKey="litres" stroke={C.blue} strokeWidth={2} isAnimationActive={false}
                dot={(p) => p.payload.flagged ? <circle key={p.index} cx={p.cx} cy={p.cy} r={4} fill={C.bad} stroke="#120F1E" strokeWidth={2} /> : <g key={p.index} />} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={{ fontSize: 11.5, color: C.sub, margin: "10px 0 6px" }}>Abnormal episodes, all buildings (last {days} days)</div>
        {data.water.episodes.length === 0 && <div style={{ fontSize: 12, color: C.sub }}>None found.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {data.water.episodes.slice(0, 6).map((e) => (
            <div key={e.buildingId + e.start} style={{ fontSize: 12, color: "#CFC7EC", display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{e.building} · {ist(e.start, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}–{hhmm(e.end)}</span>
              <span style={{ fontFamily: mono, fontSize: 11 }}>+{e.excessLitres.toLocaleString("en-IN")} L</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Method */}
      <details style={{ fontSize: 12, color: C.sub }}>
        <summary style={{ cursor: "pointer", color: C.silver }}>How these numbers are worked out</summary>
        <ul style={{ lineHeight: 1.6, paddingLeft: 18 }}>
          <li><b>Utilisation:</b> share of 15-minute weekday slots with at least one person in the room.</li>
          <li><b>Energy waste:</b> a slot counts as wasted when nobody is inside but the room draws more than 25% of its rated load (lights, fans, AC).</li>
          <li><b>Water anomaly:</b> robust z-score against the median and median absolute deviation for the same building, hour and day type; flagged above 6.</li>
          <li><b>Cost:</b> wasted kWh × assumed tariff ₹{data.tariffInrPerKwh}/kWh. Set the real tariff on the server.</li>
          <li>All calculations run in the database; readings are tagged <i>simulated</i> until real sensors replace them.</li>
        </ul>
      </details>
    </div>
  );
}

// Facilities staff only: type in a meter reading for the current 15-minute
// slot. The server re-checks the role and the value ranges.
export function LogReading({ rooms, buildings, onLogged }) {
  const [kind, setKind] = useState("water");
  const [roomId, setRoomId] = useState(rooms[0]?.id || "");
  const [buildingId, setBuildingId] = useState(buildings[0]?.id || "");
  const [powerKw, setPowerKw] = useState("");
  const [occupants, setOccupants] = useState("");
  const [litres, setLitres] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const field = { background: "#0B0914", border: "1px solid #322A50", borderRadius: 10, padding: "8px 10px", color: C.text, fontSize: 13, minWidth: 0 };
  const label = { fontSize: 11, color: C.sub, display: "flex", flexDirection: "column", gap: 4, flex: "1 1 140px" };

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setMsg(null);
    const body = kind === "water"
      ? { kind, buildingId, litres: Number(litres) }
      : { kind, roomId, powerKw: Number(powerKw), occupants: Number(occupants) };
    if (kind === "water" ? litres === "" : powerKw === "" || occupants === "") { setMsg({ ok: false, text: "Fill in every field." }); return; }
    setBusy(true);
    try {
      const r = await api("/twin/readings", { method: "POST", body });
      setMsg({ ok: true, text: `Logged for the ${hhmm(r.ts)} IST slot.` });
      setPowerKw(""); setOccupants(""); setLitres("");
      onLogged();
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <Title icon={ClipboardPen} sub="From a meter round or spot check. Goes into the current 15-minute slot and replaces the simulated value.">Log a reading</Title>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <button type="button" onClick={() => setKind("water")} aria-pressed={kind === "water"} style={btn(kind === "water")}><Droplets size={13} /> Water meter</button>
        <button type="button" onClick={() => setKind("energy")} aria-pressed={kind === "energy"} style={btn(kind === "energy")}><Zap size={13} /> Room energy</button>
      </div>
      <form onSubmit={submit} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
        {kind === "water" ? (
          <>
            <label style={label}>Building
              <select value={buildingId} onChange={(e) => setBuildingId(e.target.value)} style={field}>
                {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label style={label}>Litres in the last 15 min
              <input type="number" inputMode="decimal" min="0" max="20000" step="0.1" value={litres} onChange={(e) => setLitres(e.target.value)} style={field} />
            </label>
          </>
        ) : (
          <>
            <label style={label}>Room
              <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={field}>
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <label style={label}>Power now (kW)
              <input type="number" inputMode="decimal" min="0" step="0.01" value={powerKw} onChange={(e) => setPowerKw(e.target.value)} style={field} />
            </label>
            <label style={label}>People inside
              <input type="number" inputMode="numeric" min="0" step="1" value={occupants} onChange={(e) => setOccupants(e.target.value)} style={field} />
            </label>
          </>
        )}
        <button type="submit" disabled={busy} style={{ ...btn(true), padding: "8px 14px", opacity: busy ? 0.6 : 1 }}>{busy ? "Saving…" : "Save reading"}</button>
      </form>
      {msg && <div role="status" style={{ fontSize: 12, marginTop: 8, color: msg.ok ? C.good : C.bad }}>{msg.text}</div>}
    </Card>
  );
}

export function btn(active = false) {
  return {
    background: active ? "rgba(167,139,250,0.15)" : "rgba(196,181,253,0.04)", color: active ? "#E9E3FF" : "#CFC7EC",
    border: `1px solid ${active ? "rgba(167,139,250,0.35)" : "rgba(196,181,253,0.1)"}`, borderRadius: 9, padding: "5px 10px",
    fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, marginTop: 0,
  };
}

// Readings typed in by facilities staff.
export function ManualLog({ items }) {
  if (!items?.length) return null;
  return (
    <Card>
      <Title icon={ClipboardPen} sub="Readings typed in by facilities staff (replace the simulated value for that slot).">Recently logged by facilities</Title>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((m) => (
          <div key={m.kind + m.targetId + m.ts} style={{ fontSize: 12, color: "#CFC7EC", display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{m.kind === "water" ? "💧" : "⚡"} {m.target} · {ist(m.ts, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
            <span style={{ fontFamily: mono, fontSize: 11 }}>{m.text}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Alert rows. Buttons only for facilities (the server checks the role again).
export function AlertList({ alerts, canManage, busyKey, onAck, empty = "Nothing needs attention right now." }) {
  if (!alerts.length) return <div style={{ fontSize: 12.5, color: C.sub }}>{empty}</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {alerts.map((a) => {
        const tone = a.severity === "critical" ? C.bad : C.warn;
        const Icon = a.kind === "water_anomaly" ? Droplets : Zap;
        return (
          <div key={a.key} style={{ display: "flex", gap: 10, padding: 10, borderRadius: 12, background: "rgba(196,181,253,0.03)", border: `1px solid ${a.status === "open" ? tone + "55" : C.border}`, opacity: a.status === "resolved" ? 0.55 : 1 }}>
            <Icon size={16} color={tone} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{a.title} <span style={{ fontSize: 10.5, color: tone, fontFamily: mono }}>{a.severity.toUpperCase()}</span></div>
              <div style={{ fontSize: 12, color: "#CFC7EC", marginTop: 2 }}>{a.detail}</div>
              <div style={{ fontSize: 11.5, color: C.sub, marginTop: 2 }}>{ist(a.at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })} IST · {a.action}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                {canManage && a.status === "open" && <button disabled={busyKey === a.key} onClick={() => onAck(a.key, "acknowledged")} style={btn()}>Acknowledge</button>}
                {canManage && a.status !== "resolved" && <button disabled={busyKey === a.key} onClick={() => onAck(a.key, "resolved")} style={btn()}>Mark resolved</button>}
                {a.status !== "open" && <span style={{ fontSize: 11, color: C.good, display: "flex", gap: 4, alignItems: "center" }}><CheckCircle2 size={12} /> {a.status}</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
