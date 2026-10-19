// Data store for accounts and sessions.
//
// Two interchangeable back ends with the same methods:
//   • FileStore     — default. A JSON file on the server (server/data/),
//                     zero setup, survives restarts. Good for the demo.
//   • SupabaseStore — switched on when SUPABASE_URL and
//                     SUPABASE_SERVICE_ROLE_KEY are set. Uses the tables in
//                     supabase/migrations/0001_ghostslot_auth.sql (RLS on,
//                     no public policies: only this server can touch them).
//
// Neither store ever sees a plain password or a date of birth.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class DuplicateError extends Error {
  constructor() { super("duplicate"); this.code = "duplicate"; }
}

// ===========================================================================
// FileStore
// ===========================================================================
class FileStore {
  constructor(dir) {
    this.kind = "file";
    this.dir = dir;
    this.file = path.join(dir, "ghostslot-db.json");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = { users: [], sessions: [] };
    if (fs.existsSync(this.file)) {
      try { this.db = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch {
        console.error("[store] could not parse", this.file, "— starting empty (old file kept as .corrupt)");
        fs.renameSync(this.file, this.file + ".corrupt");
      }
    }
    this.db.users ||= [];
    this.db.sessions ||= [];
    this.db.pendingMinors ||= [];
    this.writing = Promise.resolve();
  }

  // Serialised, atomic writes: write a temp file, then rename over the real one.
  persist() {
    this.writing = this.writing.then(() => new Promise((resolve) => {
      const tmp = this.file + ".tmp";
      fs.writeFile(tmp, JSON.stringify(this.db), { mode: 0o600 }, (err) => {
        if (err) { console.error("[store] write failed", err.message); return resolve(); }
        fs.rename(tmp, this.file, (err2) => {
          if (err2) console.error("[store] rename failed", err2.message);
          resolve();
        });
      });
    }));
    return this.writing;
  }

  async findUserByRoll(rollLower) { return this.db.users.find((u) => u.roll_lower === rollLower) || null; }
  async findUserById(id) { return this.db.users.find((u) => u.id === id) || null; }
  async findUserByGuardianHash(h) { return this.db.users.find((u) => u.guardian_token_hash === h) || null; }

  // Under-18 sign-ups waiting for a parent/guardian (expire after 48 h).
  async createPendingMinor(p) {
    this.db.pendingMinors.push({ created_at: new Date().toISOString(), ...p });
    await this.persist();
  }
  async getPendingMinor(codeHash) {
    const p = this.db.pendingMinors.find((x) => x.code_hash === codeHash);
    return p && new Date(p.expires_at).getTime() > Date.now() ? p : null;
  }
  async deletePendingMinor(codeHash) {
    this.db.pendingMinors = this.db.pendingMinors.filter((x) => x.code_hash !== codeHash);
    await this.persist();
  }

  async createUser(u) {
    if (this.db.users.some((x) => x.roll_lower === u.roll_lower)) throw new DuplicateError();
    const user = { id: crypto.randomUUID(), created_at: new Date().toISOString(), last_login_at: null, ...u };
    this.db.users.push(user);
    await this.persist();
    return user;
  }
  async setLastLogin(id) {
    const u = this.db.users.find((x) => x.id === id);
    if (u) { u.last_login_at = new Date().toISOString(); await this.persist(); }
  }
  async deleteUser(id) {
    this.db.users = this.db.users.filter((u) => u.id !== id);
    this.db.sessions = this.db.sessions.filter((s) => s.user_id !== id);
    await this.persist();
  }

  async createSession(s) {
    this.db.sessions.push({ created_at: new Date().toISOString(), ...s });
    await this.persist();
  }
  async getSession(tokenHash) {
    const s = this.db.sessions.find((x) => x.token_hash === tokenHash);
    if (!s) return null;
    if (new Date(s.expires_at).getTime() <= Date.now()) return null;
    return s;
  }
  async countSessionsForUser(userId) {
    const now = Date.now();
    return this.db.sessions.filter((s) => s.user_id === userId && new Date(s.expires_at).getTime() > now).length;
  }
  async deleteSession(tokenHash) {
    this.db.sessions = this.db.sessions.filter((s) => s.token_hash !== tokenHash);
    await this.persist();
  }
  async deleteSessionsForUser(userId) {
    this.db.sessions = this.db.sessions.filter((s) => s.user_id !== userId);
    await this.persist();
  }
  async purgeExpired() {
    const now = Date.now();
    const before = this.db.sessions.length + this.db.pendingMinors.length;
    this.db.sessions = this.db.sessions.filter((s) => new Date(s.expires_at).getTime() > now);
    this.db.pendingMinors = this.db.pendingMinors.filter((p) => new Date(p.expires_at).getTime() > now);
    if (this.db.sessions.length + this.db.pendingMinors.length !== before) await this.persist();
  }
}

// ===========================================================================
// SupabaseStore (Postgres via the service-role key — server side only)
// ===========================================================================
class SupabaseStore {
  constructor(url, serviceKey) {
    this.kind = "supabase";
    this.ready = import("@supabase/supabase-js").then(({ createClient }) => {
      this.sb = createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    });
  }
  async q() { await this.ready; return this.sb; }
  static check({ error }) { if (error) throw new Error(`[supabase] ${error.message}`); }

  async findUserByRoll(rollLower) {
    const sb = await this.q();
    const r = await sb.from("gs_users").select("*").eq("roll_lower", rollLower).maybeSingle();
    SupabaseStore.check(r); return r.data;
  }
  async findUserById(id) {
    const sb = await this.q();
    const r = await sb.from("gs_users").select("*").eq("id", id).maybeSingle();
    SupabaseStore.check(r); return r.data;
  }
  async findUserByGuardianHash(h) {
    const sb = await this.q();
    const r = await sb.from("gs_users").select("*").eq("guardian_token_hash", h).maybeSingle();
    SupabaseStore.check(r); return r.data;
  }
  async createPendingMinor(p) {
    const sb = await this.q();
    SupabaseStore.check(await sb.from("gs_pending_minors").insert(p));
  }
  async getPendingMinor(codeHash) {
    const sb = await this.q();
    const r = await sb.from("gs_pending_minors").select("*").eq("code_hash", codeHash)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    SupabaseStore.check(r); return r.data;
  }
  async deletePendingMinor(codeHash) {
    const sb = await this.q();
    SupabaseStore.check(await sb.from("gs_pending_minors").delete().eq("code_hash", codeHash));
  }
  async createUser(u) {
    const sb = await this.q();
    const r = await sb.from("gs_users").insert(u).select().single();
    if (r.error && r.error.code === "23505") throw new DuplicateError();
    SupabaseStore.check(r); return r.data;
  }
  async setLastLogin(id) {
    const sb = await this.q();
    SupabaseStore.check(await sb.from("gs_users").update({ last_login_at: new Date().toISOString() }).eq("id", id));
  }
  async deleteUser(id) {
    const sb = await this.q();
    SupabaseStore.check(await sb.from("gs_users").delete().eq("id", id)); // sessions cascade
  }
  async createSession(s) {
    const sb = await this.q();
    SupabaseStore.check(await sb.from("gs_sessions").insert(s));
  }
  async getSession(tokenHash) {
    const sb = await this.q();
    const r = await sb.from("gs_sessions").select("*").eq("token_hash", tokenHash)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    SupabaseStore.check(r); return r.data;
  }
  async countSessionsForUser(userId) {
    const sb = await this.q();
    const r = await sb.from("gs_sessions").select("token_hash", { count: "exact", head: true })
      .eq("user_id", userId).gt("expires_at", new Date().toISOString());
    SupabaseStore.check(r); return r.count || 0;
  }
  async deleteSession(tokenHash) {
    const sb = await this.q();
    SupabaseStore.check(await sb.from("gs_sessions").delete().eq("token_hash", tokenHash));
  }
  async deleteSessionsForUser(userId) {
    const sb = await this.q();
    SupabaseStore.check(await sb.from("gs_sessions").delete().eq("user_id", userId));
  }
  async purgeExpired() {
    const sb = await this.q();
    SupabaseStore.check(await sb.from("gs_sessions").delete().lte("expires_at", new Date().toISOString()));
    SupabaseStore.check(await sb.from("gs_pending_minors").delete().lte("expires_at", new Date().toISOString()));
  }
}

export function createStore() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    console.log("[store] using Supabase");
    return new SupabaseStore(url, key);
  }
  const dir = process.env.DATA_DIR || path.join(__dirname, "data");
  console.log("[store] using local file store at", dir);
  return new FileStore(dir);
}
