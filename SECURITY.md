# GhostSlot security report (v0.4)

These are the checks run on this codebase, against the OWASP Top 10 (2021) and the OWASP
ASVS / Cheat Sheet guidance for web apps. They cover what was wrong in v0.1, what changed,
and how it's tested (`npm test`, 24 tests).

## What was wrong in v0.1

| # | Problem | Risk |
|---|---|---|
| 1 | Login and signup ran **only in the browser**. Users and passwords were kept in React state | Anyone could log in by editing the page. No real accounts existed |
| 2 | Demo password `test123` was **hard-coded in the JavaScript bundle** | Visible to anyone who opened DevTools |
| 3 | The AI search box called Gemini **from the browser** with `VITE_GEMINI_API_KEY` | The API key was bundled into public JS, so anyone could copy it and spend your quota |
| 4 | Wi-Fi CSI write endpoints (`/csi/demo-room`, `/calibrate`, `/mode`) had **no authentication** | Anyone on the network could fake sensor readings or switch the room to another mode |
| 5 | `cors()` allowed **every origin** | Any website could call the API |
| 6 | **No security headers** (CSP, frame, nosniff, HSTS) | Clickjacking and injected-script risk |
| 7 | **No rate limits** on login or AI | Password guessing, and AI cost abuse |
| 8 | Gemini key sent as `?key=` **in the URL** | Keys in URLs end up in logs |
| 9 | Login said "No student with that roll number" | Account enumeration |
| 10 | Fonts loaded from **Google's servers** | Visitor IPs shared with a third party (legal check #2) |
| 11 | CSV upload had **no size or row limit** | A huge file could freeze the tab |

## What v0.2 does (OWASP mapping)

**A01 Broken access control**
- Real server-side accounts. AI endpoints require a signed-in session.
- CSI device writes need `X-Device-Key`; admin endpoints need `X-Admin-Key`, and are **off** if no key is set (fail closed).
- The OLED can only mark itself online with the device key.

**A02 Cryptographic failures**
- Passwords: **scrypt** (N=2¹⁶, r=8, p=2, 16-byte random salt), the OWASP-recommended parameters. Verification is constant-time.
- Sessions: 256-bit random tokens. The browser holds the token in an **httpOnly, SameSite=Strict** cookie (`Secure` + `__Host-` prefix in production). The database stores only a **SHA-256 of the token**, so a leaked DB can't be replayed.
- Age-gate passes and the lock cookie are **HMAC-SHA256 signed** with `SESSION_SECRET`. The server refuses to start in production without a 32+ character secret.

**A03 Injection**
- All inputs are validated against allow-lists (roll `^[A-Za-z0-9]{6,15}$`, name, date format), control characters are stripped, and lengths are capped.
- The CampusAI context is **rebuilt server-side** from allow-listed fields (≤40 rooms, capped strings), so the browser can't stuff the prompt. User text is passed as JSON data, and the system prompt tells the model to ignore embedded instructions (prompt-injection hardening).
- AI replies are length-capped, and action buttons are only allowed for room IDs we actually sent.
- React escapes all rendered text; there's no `dangerouslySetInnerHTML`.

**A04 Insecure design**
- The age gate is enforced **on the server** with a single-use, 20-minute pass. The UI can't skip it.
- Login returns the **same message and the same timing** (a dummy scrypt run) whether or not the roll number exists.
- Session rotation on login; *Sign out everywhere*; account deletion requires the password.

**A05 Security misconfiguration**
- Helmet headers: strict **Content-Security-Policy** (`script-src 'self'`, `font-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, **HSTS** in production, `X-Powered-By` removed.
- `Permissions-Policy`: camera, location, payment and USB off; microphone only for our own page (voice input).
- CORS: allow-list only. **CSRF**: every state-changing request must carry our own `Origin` (on top of SameSite=Strict).
- API responses are `Cache-Control: no-store`. Generic error messages, no stack traces. No source maps shipped.
- Fonts are built as real files (no `data:` URIs), so the CSP never needs loosening.

**A06 Vulnerable components**
- Vite upgraded to 6.4. `npm audit` shows **0 vulnerabilities** in both the frontend and the backend.

**A07 Identification & authentication failures**
- Password policy per NIST SP 800-63B: minimum 8, maximum 128, common passwords blocked, no name or roll number inside.
- Rate limits: login 5 failed tries per roll number per 15 min and 40 per IP; signup 20/h per IP; age check 30/h per IP; delete-account 5 failed tries per 15 min. Limits are generous per IP because a whole campus can share one IP.
- 7-day session lifetime; expired sessions are purged hourly.

**A08 Software & data integrity**
- No third-party scripts or CDNs at runtime: everything is bundled and self-hosted.

**A09 Logging & monitoring**
- Server errors are logged without passwords, tokens, dates of birth or prompts. The Gemini key is sent in a header, not the URL.

**Campus Twin (0.4)**
- `/api/twin/*` is for signed-in users only and rate-limited (60 requests/min per IP). The alert-ack endpoint also needs our own `Origin`, and validates the alert key against a strict pattern and the status against an allow-list.
- Twin tables have RLS on with no policies, `anon`/`authenticated` have no grants, and `EXECUTE` on every twin function is revoked from them, so the public Supabase API can't read or run any of it. Only the server's service-role key can.
- **Roles** (student / faculty / facilities) are stored on the account and checked on the server. Only facilities staff can log readings or acknowledge/resolve alerts (403 otherwise). Facilities self sign-up needs `FACILITIES_ACCESS_CODE` (compared in constant time) and is closed when it isn't set. Login must match the picked role, with the same generic error either way. Each role gets its own set of screens; `GET /api/twin/me` (a staff member's own work log) is facilities-only and filters to the caller's own rows twice (in the query and again in code).
- **Guardian consent:** the consent code is 256-bit random, only its SHA-256 is stored, it travels after `#` (not sent to the server in the URL or logged), lookups/approvals are rate-limited (30 per 15 min per IP), and the guardian can't use the student's own name. A database CHECK makes it impossible to store an under-18 account that isn't a student with recorded consent. A minor age token can't create a staff account. Pending requests expire after 48 h and are purged hourly.
- Logged readings are range-checked against the room's rated load and capacity, snapped to the current 15-minute slot, rate-limited (30 per staff member per 10 min) and attributed (`logged_by`).
- The shared demo accounts can't be deleted or use *Sign out everywhere*, so one visitor can't lock other judges out.
- Every twin function has a pinned `search_path` (Supabase security advisor clean apart from the intended "RLS with no policies" notice).
- The ₹ figures use an assumed tariff and the data is labelled simulated in the API (`dataSource`) and the UI.

**A10 SSRF**
- The server only calls fixed hosts: Google's Gemini API and your own Supabase project URL from the environment. The model name is URL-encoded, and no user-supplied URLs are ever fetched.

**Frontend extras**
- CSV import: 256 KB maximum, first 500 rows only, cells cleaned and capped at 60 characters.
- No secrets anywhere in the frontend. There are no `VITE_` keys; the bundle was scanned.

## Before a real public launch
- Set `DEMO_ACCOUNT=off`, a strong `SESSION_SECRET`, and `NODE_ENV=production`.
- Use Supabase (or another real database) instead of the local file store.
- Add the real grievance contact email to `src/auth/PrivacyNotice.jsx`.
- Self-declared date of birth is the standard age gate for this kind of app, but it isn't ID verification. If the university needs stronger checks, verify against the student roll records instead.
