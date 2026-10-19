// Security primitives shared by the auth, age-gate and device routes.
// Everything here uses Node's built-in `crypto` — no native add-ons, so it
// installs the same on Mac, Windows and Linux.
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Server secret (signs age-gate tokens and the age-gate lock cookie).
// In production it MUST come from the environment; in development we
// generate one per run and warn, so nothing secret is ever committed.
// ---------------------------------------------------------------------------
const IS_PROD = process.env.NODE_ENV === "production";
let SECRET = process.env.SESSION_SECRET || "";
if (SECRET.length < 32) {
  if (IS_PROD) {
    throw new Error("SESSION_SECRET must be set to at least 32 random characters in production.");
  }
  SECRET = crypto.randomBytes(48).toString("hex");
  console.warn("[security] SESSION_SECRET not set — using a random one for this dev run only.");
}
export { IS_PROD };

// ---------------------------------------------------------------------------
// Password hashing — scrypt with OWASP-recommended parameters
// (N=2^16, r=8, p=2 ≈ 64 MiB per hash). Stored as a self-describing string
// so parameters can be raised later without breaking old hashes.
// ---------------------------------------------------------------------------
const SCRYPT = { N: 2 ** 16, r: 8, p: 2, keylen: 64 };
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

function scryptAsync(password, salt, { N, r, p, keylen }) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, { N, r, p, maxmem: SCRYPT_MAXMEM }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password.normalize("NFKC"), salt, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, saltB64, keyB64] = String(stored).split("$");
    if (algo !== "scrypt") return false;
    const expected = Buffer.from(keyB64, "base64");
    const key = await scryptAsync(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), {
      N: Number(N), r: Number(r), p: Number(p), keylen: expected.length,
    });
    return crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// A real hash of a random password, used to burn the same CPU time when a
// login names a roll number that doesn't exist (stops timing-based account
// discovery).
let dummyHashPromise = null;
export function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(crypto.randomBytes(16).toString("hex"));
  return dummyHashPromise;
}

// ---------------------------------------------------------------------------
// Opaque session tokens: 256 random bits to the browser, only a SHA-256 of
// it is stored, so a leaked database can't be replayed as live sessions.
// ---------------------------------------------------------------------------
export function newToken() {
  return crypto.randomBytes(32).toString("base64url");
}
export function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

// ---------------------------------------------------------------------------
// Small signed tokens (HMAC-SHA256) for the age gate. Payload is JSON,
// never contains the date of birth.
// ---------------------------------------------------------------------------
function hmac(data) {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}
export function signPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(body)}`;
}
export function verifyPayload(token) {
  if (typeof token !== "string" || token.length > 600) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = hmac(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Age calculation. Calendar-exact (a birthday counts from the day itself),
// evaluated on today's date in India (IST), with strict date validation so
// "2007-02-30" or a future date is rejected rather than silently rolled over.
// ---------------------------------------------------------------------------
export const MIN_AGE = 18;

export function parseDob(dob) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob || ""));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, mo, d };
}

export function ageOn(dob, now = new Date()) {
  const p = parseDob(dob);
  if (!p) return null;
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const ty = ist.getUTCFullYear(), tm = ist.getUTCMonth() + 1, td = ist.getUTCDate();
  if (p.y > ty || (p.y === ty && (p.mo > tm || (p.mo === tm && p.d > td)))) return -1; // in the future
  let age = ty - p.y;
  if (tm < p.mo || (tm === p.mo && td < p.d)) age -= 1;
  return age;
}

// ---------------------------------------------------------------------------
// Input validation helpers (allow-lists, length caps).
// ---------------------------------------------------------------------------
export const ROLL_RE = /^[A-Za-z0-9]{6,15}$/;

// Who can have an account, and the department / team lists each role picks
// from. Keep these in sync with src/auth/roles.js (the UI copy).
export const ROLES = ["student", "faculty", "facilities"];
export const DEPARTMENTS = {
  faculty: ["CSE", "AIT-CSE", "ECE", "Mechanical", "Civil", "Applied Sciences", "Management", "Other"],
  facilities: ["Electrical", "Plumbing", "Housekeeping", "Estate office"],
};
export const NAME_RE = /^[\p{L}][\p{L} .'-]{1,59}$/u;

// A short list of the most common passwords (NIST SP 800-63B asks services
// to reject known-compromised / very common choices).
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123",
  "qwertyuiop", "iloveyou", "11111111", "00000000", "abcd1234", "admin123", "welcome1",
  "letmein1", "football", "baseball", "sunshine", "princess", "dragon12", "monkey123",
  "test1234", "testtest", "ghostslot", "ghostslot1", "chandigarh", "chandigarh1", "cu123456",
]);

export function passwordProblem(pw, { roll, name } = {}) {
  if (typeof pw !== "string") return "Password is required.";
  if (pw.length < 8) return "Use at least 8 characters.";
  if (pw.length > 128) return "That's too long (max 128 characters).";
  const lower = pw.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return "That password is on every hacker's list. Pick another.";
  if (roll && lower.includes(String(roll).toLowerCase())) return "Don't put your roll number in your password.";
  if (name && name.length >= 3 && lower.includes(String(name).toLowerCase().split(" ")[0])) return "Don't put your name in your password.";
  if (/^(.)\1+$/.test(pw)) return "One character repeated isn't a password.";
  return null;
}

// Strips control characters and trims to a max length.
export function cleanText(v, max) {
  return String(v ?? "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
}
