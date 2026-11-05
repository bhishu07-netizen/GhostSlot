# GhostSlot

Find an empty classroom on campus, straight from the timetable. Team COGNIX, Chandigarh University.

GhostSlot does one job: it shows which classrooms, labs, lecture halls and library pods are
**empty right now** (no class timetabled, nobody has booked it), how long they stay empty,
and lets you book one. That's it. No Wi-Fi sensing, no cameras, no crowd monitoring.

**Who it's for**

| Login | What they get |
|---|---|
| Student | Free rooms ranked for what they need, the campus map with directions, their own timetable (so it knows when they're free), booking, AI search |
| Faculty | Their teaching day, free rooms for an extra class, booking, map, AI search |

**What's in the app**

- **Find:** every room with its status from the timetable: free for how long, or busy until when.
  Filters for duration, block, seats, charging, AC, quiet. "Only my free time" uses your own timetable.
- **AI search:** type it the way you'd say it ("quiet room near CSE for 90 minutes with charging").
  Uses Gemini when a key is set, otherwise a built-in parser.
- **Map:** the rooms on the campus map, green when free, with walking time and directions from where you are.
- **Booking:** only rooms the timetable shows as empty can be booked, and you say what it's for.
  Students: group study, project work, exam / placement prep. Faculty: extra class, doubt / remedial
  session, other work. It frees itself when the time is up, or tap "I'm out".
- **Timetable:** add your classes (or import a CSV), and the room timetables (manually or CSV).

See [SECURITY.md](SECURITY.md) and [COMPLIANCE.md](COMPLIANCE.md).

---

## Run it locally (VS Code)

You need **Node.js 20 or newer** (`node -v` to check).

1. Unzip, then in VS Code: `File → Open Folder` → pick the `ghostslot` folder.
2. Open the terminal (`` Ctrl+` `` / `` Cmd+` ``) and install everything once:
   ```bash
   npm run setup
   ```
3. Create the backend settings file:
   ```bash
   cp server/.env.example server/.env
   ```
   (Windows PowerShell: `copy server\.env.example server\.env`)
   It works as-is for a demo. Paste your Gemini key into `GEMINI_API_KEY=` if you want the AI features.
4. Start the backend and the app together:
   ```bash
   npm run dev:all
   ```
5. Open **http://localhost:5173**

**Demo logins** (shown on the login screen): student `23BCS10432` and faculty `E21045`, both with password `Ghost-Demo-2026` (change it with `DEMO_PASSWORD`; it's public on purpose
so judges can get in).

> Login now really needs the backend. If you only run `npm run dev`, the
> login screen will say it can't reach the server.

### Useful commands

| Command | What it does |
|---|---|
| `npm run setup` | Installs frontend + backend packages |
| `npm run dev:all` | Runs backend (port 8787) + app (port 5173) |
| `npm test` | Runs the security, role, guardian-consent and age-gate tests |
| `npm run audit` | Checks every package for known vulnerabilities |
| `npm run build` then `npm start` | Production mode: the backend serves the built app on one origin |

---

## Live time vs demo time

The clock at the top follows the **real time in India (IST)** by default (green *live IST* chip),
on any device timezone. Change the day or time by hand to look ahead, tap **back to now** to return,
or tap **demo time** (Mon 11:15) for the pitch, where the sample timetables tell the cleanest story.
Classrooms show as *closed* on Sundays and outside 09:00–17:00.

---

## Under-18 students (parent / guardian consent)

College students can be under 18. Under India's DPDP Act 2023 (s.9) they're "children", so an app
needs a parent's or guardian's verifiable consent before it stores their data. GhostSlot does this:

1. An under-18 **student** signs up normally. The age check says *parent or guardian approval needed*.
2. Their details wait in `gs_pending_minors` (password already hashed). **Nothing is an account yet**;
   unapproved requests are deleted after 48 hours.
3. They send the parent a link (`/guardian#<code>`, *Send to parent* uses the phone's share sheet).
   The code sits after `#`, so it never reaches server logs.
4. The parent sees exactly what's stored and why, gives their name and relation, confirms they're
   an adult (date of birth checked once, not saved) and approves. Then the account is created.
5. The student gets **the same access as any student**. GhostSlot keeps no behaviour scores for anyone.
6. The parent can come back to the same link to **withdraw consent**, which deletes the account.

Faculty accounts stay **18+ only**. Limitation: the parent's details are
self-declared (one of the routes DPDP Rules r.10 allows). For stronger checks, verify against the
university's admission records or a DigiLocker age token.

---

## Sign up and the age gate

Signup is three steps: **You → Age check → Secure**.

- **Age check:** the student picks their date of birth (day/month/year, nothing pre-filled).
  The server works out the exact age (on India's date). If they're 18+,
  they get a one-time pass that's valid for 20 minutes. The date of birth is then
  discarded: it's never saved, logged or sent anywhere else.
- **Under 18 (faculty):** no account is created. The student sees a clear, kind explanation
  (DPDP Act 2023). Sign-up is paused on that browser for 24 hours so they can't
  just go back and change the year.
- **Can't be skipped:** the server refuses any signup without a valid,
  unused pass from the age check, even if someone calls the API directly.

The **You** tab has a **Security & privacy** card: 18+ verified badge, active
sessions, *Sign out everywhere*, the privacy notice, and *Delete my account*.

---

## The logo

The ghost logo is already in `public/brand/` (app icon, favicon, home-screen icon and
`manifest.webmanifest`, so "Add to Home Screen" works). The in-app mark is in
`src/brand/BrandMark.jsx`. To change it, replace the PNGs in `public/brand/` with the same names.

---

## "Where are you?" — closest best room from your spot

Find and Map ask where you are, then rank rooms by **real walking time from you**.

| Way | How |
|---|---|
| **Room link** | Opening `/?at=<room id>` (e.g. from a printed sign) sets your spot to that room |
| **Pick place** | One tap from a list of blocks, rooms and spots |
| **Tap the map** | *Set my spot on the map*, then tap |
| **GPS** | Works once the map is calibrated (below) |

- *Take me there* (Best Match) and *Go* (your booking bar) open the map with a route and "~N min".
- With a spot set, Best Match gives distance more weight (`calculateRoomScore` in `src/App.jsx`).
- Your spot stays on this phone for 3 hours, then asks again. It is never sent to the server.

**Turning GPS on:** add at least 3 real coordinates (spread out on campus) to `GEO_ANCHORS` in
`src/campus.js`, each matched to its x/y on the map. No coordinates are guessed. Until this is done,
GPS falls back to *Pick place*.

## Built not to break

- Double taps are ignored on booking, *I'm out*, AI search, login and signup; the same API
  call fired twice shares one request, and every call times out after 15 s with a clear message.
- Before locking a room the app re-checks it's still free. One booking at a time.
- A booking stores its real end time, so it survives a refresh or a sleeping phone and frees the
  room automatically. Your timetable and booking are saved per user on this browser.
- If one screen crashes it shows *Try again* instead of a blank page. An offline banner shows
  when the connection drops.

---

## AI features (Gemini key, optional)

Both AI features now call Gemini **only from the backend**, so the key never ends up in the browser:

- **AI-assisted room search**, e.g. *"quiet place near CSE for 90 minutes with charging"*.
  Without a key, it uses the built-in rule-based parser (badge says *local parser*).
- **CampusAI** chat (🤖 button), in English, Hindi or Punjabi, typed or spoken.
  Without a key, it shows a friendly "temporarily unavailable" message.

Put the key in `server/.env` → `GEMINI_API_KEY=`. Get one at https://aistudio.google.com/apikey.
Both features are for signed-in users only and are rate-limited per account.

---

## Accounts storage: local file or Supabase

- **Default:** a local file, `server/data/ghostslot-db.json` (hashed passwords, no birth dates).
  This is fine for a demo, and it's git-ignored.
- **Supabase (recommended for a real deploy):**
  1. In your Supabase project → SQL editor → run `supabase/migrations/0001_ghostslot_auth.sql`.
  2. In `server/.env`, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API).
  3. Restart. The server log says `[store] using Supabase`.

  The service-role key is a **secret**: it goes in `server/.env` only, never in the frontend
  and never in a `VITE_` variable. The tables have Row Level Security on with no public
  policies, so the public Supabase API can't read them.

---

## Deploy (one service: app + backend together)

Use **Render** with the included `render.yaml` (Dashboard → New → Blueprint).
The app and API run on one domain, which the secure cookies and the CSP rely on.
Render asks for `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (required: accounts live there, and Render's free disk is wiped on every deploy) and `GEMINI_API_KEY` (optional).
Free Render services sleep after 15 idle minutes, so open the link ~1 minute before a demo.
Before a real launch, set `DEMO_ACCOUNT=off`.

> A frontend-only deploy (e.g. the old Vercel site) can't log anyone in any more,
> because accounts now live on the server.

---

## Push to GitHub

```bash
git init
git add .
git commit -m "GhostSlot 0.2: SkillTwin UI, age gate, security hardening"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo-name>.git
git push -u origin main
```
`.env`, `server/.env` and `server/data/` are git-ignored, so no secrets or accounts get pushed.

---

## Acknowledgements

Built by Bhavishay (Bhishu), Team COGNIX, Chandigarh University, with help from AI tools (Claude).

