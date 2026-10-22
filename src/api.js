// Tiny fetch wrapper for the GhostSlot backend. Same-origin only; the
// session lives in an httpOnly cookie the browser sends automatically, so
// no token is ever readable by JavaScript.
const BASE = (import.meta.env && import.meta.env.VITE_API_BASE) || "/api";

// The same request fired twice while the first is still running (double tap,
// double click, Enter + click) shares one network call instead of two.
const inFlight = new Map();
const TIMEOUT_MS = 15000;

export function api(path, opts = {}) {
  const k = `${opts.method || "GET"} ${path} ${opts.body !== undefined ? JSON.stringify(opts.body) : ""}`;
  if (inFlight.has(k)) return inFlight.get(k);
  const p = request(path, opts).finally(() => inFlight.delete(k));
  inFlight.set(k, p);
  return p;
}

async function request(path, { method = "GET", body } = {}) {
  let res;
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl ? ctrl.signal : undefined,
    });
  } catch (err) {
    const slow = err && err.name === "AbortError";
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    const e = new Error(offline ? "You're offline. Reconnect and try again." : slow ? "The server is taking too long (it may be waking up). Try again in a few seconds." : "Can't reach the GhostSlot server. Check your connection and try again.");
    e.code = slow ? "timeout" : "network";
    throw e;
  } finally { if (timer) clearTimeout(timer); }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const e = new Error((data && data.message) || friendly(data && data.error) || `Request failed (${res.status})`);
    e.status = res.status;
    e.code = data && data.error;
    e.data = data;
    throw e;
  }
  return data;
}

function friendly(code) {
  return {
    rate_limited: "Too many tries. Give it a minute.",
    bad_origin: "Blocked for safety. Reload the page and try again.",
    not_signed_in: "Your session ended. Please log in again.",
    server_error: "Something broke on our side. Try again.",
  }[code];
}
