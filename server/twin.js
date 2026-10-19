// Campus Twin API: utilisation, energy waste, water anomalies and live room
// state, computed in Postgres (supabase/migrations/0002_ghostslot_twin.sql)
// and served to signed-in users only.
//
// DATA HONESTY: until CU meters are connected, readings come from the
// simulator in the database (source = 'simulated'), and every response says
// so in `dataSource`. The ₹ figures use an assumed tariff (TWIN_TARIFF_INR_PER_KWH).
import express from "express";

const TARIFF = clampNum(Number(process.env.TWIN_TARIFF_INR_PER_KWH), 1, 50, 8);
const CACHE_MS = 60 * 1000;
const TICK_MS = 5 * 60 * 1000;
const BACKFILL_MAX_MS = 14 * 24 * 3600 * 1000;

// Who may acknowledge/resolve facilities alerts: roll numbers listed in
// TWIN_ADMIN_ROLLS (comma separated). Default: the judges' demo account, so
// the demo works, while ordinary student sign-ups only get read access.
function adminRolls() {
  const raw = process.env.TWIN_ADMIN_ROLLS || (process.env.DEMO_ACCOUNT === "off" ? "" : (process.env.DEMO_ROLL || "23BCS10432"));
  return new Set(raw.split(",").map((r) => r.trim().toLowerCase()).filter(Boolean));
}
const canManage = (user) => !!user && adminRolls().has(String(user.roll_lower || "").toLowerCase());

function clampNum(v, lo, hi, dflt) { return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt; }
const num = (v) => (v === null || v === undefined ? null : Number(v));

// `client` lets tests pass a fake Supabase client.
export function buildTwin({ requireAuth, sameOriginOnly, client: injected = null, autoTick = true }) {
  const router = express.Router();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let sbPromise = injected ? Promise.resolve(injected) : null;
  const sb = () => {
    if (injected) return sbPromise;
    if (!url || !key) return null;
    sbPromise ||= import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
    return sbPromise;
  };

  async function rpc(fn, args) {
    const client = await sb();
    const r = await client.rpc(fn, args);
    if (r.error) throw new Error(`[twin] ${fn}: ${r.error.message}`);
    return r.data;
  }
  async function table(name, build) {
    const client = await sb();
    const r = await build(client.from(name));
    if (r.error) throw new Error(`[twin] ${name}: ${r.error.message}`);
    return r.data;
  }

  const cache = new Map();

  // Keep the simulated feed flowing so the twin always shows "now".
  // Backfills from the latest stored reading, so a server that slept for
  // hours (Render free tier) doesn't leave holes in the history.
  async function tick() {
    if (!sb()) return;
    try {
      const now = Date.now();
      const latest = await table("gs_twin_readings", (q) => q.select("ts").order("ts", { ascending: false }).limit(1));
      const last = latest?.[0]?.ts ? new Date(latest[0].ts).getTime() : now - BACKFILL_MAX_MS;
      let from = Math.max(last, now - BACKFILL_MAX_MS);
      // gs_twin_generate accepts at most 31 days; chunk by 7 to keep each call small.
      while (from < now) {
        const to = Math.min(from + 7 * 24 * 3600 * 1000, now);
        await rpc("gs_twin_generate", { p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString() });
        from = to;
      }
      cache.clear();
    } catch (e) { console.error(e.message); }
  }
  if (autoTick && (injected || (url && key))) {
    tick();
    setInterval(tick, TICK_MS).unref();
  }

  const notConfigured = (_req, res, next) =>
    sb() ? next() : res.status(503).json({ error: "twin_not_configured", message: "The campus twin needs the Supabase database. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." });

  // ---- Overview ----------------------------------------------------------
  async function overview(days) {
    const hit = cache.get(days);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

    const [rooms, buildings, now, energy, daily, heatmap, anomalies, acks] = await Promise.all([
      table("gs_twin_rooms", (q) => q.select("id,name,block,kind,capacity,rated_kw").order("id")),
      table("gs_twin_buildings", (q) => q.select("id,name").order("id")),
      rpc("gs_twin_now"),
      rpc("gs_twin_energy", { p_days: days }),
      rpc("gs_twin_energy_daily", { p_days: 14 }),
      rpc("gs_twin_heatmap", { p_days: days }),
      rpc("gs_twin_water_anomalies", { p_days: days, p_z: 6 }),
      table("gs_twin_alert_acks", (q) => q.select("alert_key,status,at")),
    ]);
    const ackMap = new Map(acks.map((a) => [a.alert_key, a]));
    const roomName = new Map(rooms.map((r) => [r.id, r.name]));
    const bName = new Map(buildings.map((b) => [b.id, b.name]));

    const energyRows = energy.map((e) => ({
      roomId: e.room_id, name: roomName.get(e.room_id) || e.room_id,
      totalKwh: num(e.total_kwh), wastedKwh: num(e.wasted_kwh), wasteHours: num(e.waste_hours),
      wastedInr: Math.round(num(e.wasted_kwh) * TARIFF), classHourUtilPct: num(e.occupied_util_pct),
    })).sort((a, b) => b.wastedKwh - a.wastedKwh);
    const totalKwh = energyRows.reduce((s, r) => s + r.totalKwh, 0);
    const wastedKwh = energyRows.reduce((s, r) => s + r.wastedKwh, 0);

    // Group anomalous water readings into episodes (back-to-back 15-min slots).
    const sorted = [...anomalies].sort((a, b) => (a.building_id + a.ts).localeCompare(b.building_id + b.ts));
    const episodes = [];
    for (const a of sorted) {
      const t = new Date(a.ts).getTime();
      const last = episodes[episodes.length - 1];
      const excess = Math.max(0, num(a.litres) - num(a.baseline));
      if (last && last.buildingId === a.building_id && t - last._end <= 15 * 60 * 1000) {
        last._end = t; last.end = a.ts; last.excessLitres += excess; last.peakZ = Math.max(last.peakZ, num(a.z)); last.readings += 1;
      } else {
        episodes.push({ buildingId: a.building_id, building: bName.get(a.building_id) || a.building_id, start: a.ts, end: a.ts, _end: t, excessLitres: excess, peakZ: num(a.z), readings: 1 });
      }
    }
    for (const e of episodes) { e.excessLitres = Math.round(e.excessLitres); delete e._end; }
    episodes.sort((a, b) => b.start.localeCompare(a.start));

    const nowRows = now.map((n) => ({ roomId: n.room_id, name: roomName.get(n.room_id) || n.room_id, ts: n.ts, occupants: n.occupants, powerKw: num(n.power_kw), state: n.state }));

    // Alerts: rooms wasting power right now, recent water episodes, and
    // rooms left mostly empty during class hours.
    const alerts = [];
    for (const n of nowRows.filter((r) => r.state === "wasting")) {
      const k = `energy:${n.roomId}:${n.ts.slice(0, 13)}`;
      alerts.push({ key: k, kind: "energy_waste", severity: "serious", title: `${n.name} is powered on but empty`,
        detail: `Drawing ${n.powerKw.toFixed(2)} kW with nobody inside (≈ ₹${Math.round(n.powerKw * TARIFF)}/hour).`,
        action: "Ask the block attendant to switch off lights, fans and AC.", at: n.ts, status: ackMap.get(k)?.status || "open" });
    }
    for (const e of episodes.slice(0, 6)) {
      const k = `water:${e.buildingId}:${e.start}`;
      alerts.push({ key: k, kind: "water_anomaly", severity: e.peakZ >= 20 ? "critical" : "serious", title: `Unusual water use in ${e.building}`,
        detail: `${e.excessLitres.toLocaleString("en-IN")} L above normal for that time of day (${e.readings * 15} min, peak ${e.peakZ}× normal spread).`,
        action: "Check for a running tap, cistern or pipe leak.", at: e.start, status: ackMap.get(k)?.status || "open" });
    }
    const suggestions = energyRows
      .filter((r) => r.classHourUtilPct !== null && r.classHourUtilPct < 30)
      .map((r) => ({ roomId: r.roomId, name: r.name, utilPct: r.classHourUtilPct,
        text: `${r.name} is used only ${r.classHourUtilPct}% of class hours. Open it as a study space, or move a small section here and free a bigger room.` }));

    const data = {
      dataSource: "simulated",
      generatedAt: new Date().toISOString(),
      windowDays: days,
      tariffInrPerKwh: TARIFF,
      rooms, buildings,
      now: nowRows,
      energy: { rooms: energyRows, totalKwh: Math.round(totalKwh), wastedKwh: Math.round(wastedKwh),
                wastedPct: totalKwh ? Math.round((1000 * wastedKwh) / totalKwh) / 10 : 0, wastedInr: Math.round(wastedKwh * TARIFF),
                daily: daily.map((d) => ({ day: d.day, totalKwh: num(d.total_kwh), wastedKwh: num(d.wasted_kwh) })) },
      heatmap: heatmap.map((h) => ({ roomId: h.room_id, hour: h.hour, utilPct: num(h.util_pct) })),
      water: { episodes },
      alerts: alerts.sort((a, b) => b.at.localeCompare(a.at)),
      suggestions,
    };
    cache.set(days, { at: Date.now(), data });
    return data;
  }

  router.get("/twin/overview", requireAuth, notConfigured, async (req, res, next) => {
    const days = [7, 14].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
    try { res.json({ ...(await overview(days)), canManageAlerts: canManage(req.user) }); } catch (e) { next(e); }
  });

  // Water series for one building (last 48 h, 15-min readings).
  router.get("/twin/water", requireAuth, notConfigured, async (req, res, next) => {
    const id = String(req.query.building || "");
    if (!/^[A-Za-z0-9-]{1,40}$/.test(id)) return res.status(400).json({ error: "bad_building" });
    try {
      const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const rows = await table("gs_twin_water", (q) => q.select("ts,litres").eq("building_id", id).gte("ts", since).order("ts"));
      res.json({ buildingId: id, dataSource: "simulated", readings: rows.map((r) => ({ ts: r.ts, litres: num(r.litres) })) });
    } catch (e) { next(e); }
  });

  // Facilities marks an alert as acknowledged or resolved.
  router.post("/twin/alerts/ack", sameOriginOnly, requireAuth, notConfigured, async (req, res, next) => {
    if (!canManage(req.user)) return res.status(403).json({ error: "facilities_only", message: "Only facilities staff can update alerts." });
    const k = String(req.body?.key || "");
    const status = req.body?.status;
    if (!/^(energy|water):[A-Za-z0-9-]{1,40}:[0-9T:.+\-Z]{10,40}$/.test(k)) return res.status(400).json({ error: "bad_key" });
    if (!["acknowledged", "resolved"].includes(status)) return res.status(400).json({ error: "bad_status" });
    try {
      const client = await sb();
      const r = await client.from("gs_twin_alert_acks").upsert({ alert_key: k, status, user_id: req.user.id, at: new Date().toISOString() });
      if (r.error) throw new Error(`[twin] ack: ${r.error.message}`);
      cache.clear();
      res.json({ ok: true, key: k, status });
    } catch (e) { next(e); }
  });

  return router;
}
