# GhostSlot

AI-powered Campus Space Intelligence System. Team COGNIX, Chandigarh University.

Version 0.4 adds the **Campus Digital Twin** (DataVerse X, PS #3): live room
state, classroom utilisation heatmap, energy-waste detection with ₹ estimates,
water-leak anomaly detection, alerts facilities can acknowledge, and room
reallocation suggestions. All of it is computed in **Supabase Postgres**.
Earlier versions added the SkillTwin silver-on-black look, a server-checked
18+ age gate and a full security pass. See [SECURITY.md](SECURITY.md) and
[COMPLIANCE.md](COMPLIANCE.md).

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

**Demo login** (shown on the login screen): roll `23BCS10432`, password `Ghost-Demo-2026`
(change it with `DEMO_PASSWORD`; it's public on purpose so judges can get in).

> Login now really needs the backend. If you only run `npm run dev`, the
> login screen will say it can't reach the server.

### Useful commands

| Command | What it does |
|---|---|
| `npm run setup` | Installs frontend + backend packages |
| `npm run dev:all` | Runs backend (port 8787) + app (port 5173) |
| `npm test` | Runs the 19 security, age-gate and twin tests |
| `npm run audit` | Checks every package for known vulnerabilities |
| `npm run build` then `npm start` | Production mode: the backend serves the built app on one origin |

---

## Live time vs demo time

The clock at the top follows the **real time in India (IST)** by default (green *live IST* chip),
on any device timezone. Change the day or time by hand to look ahead, tap **back to now** to return,
or tap **demo time** (Mon 11:15) for the pitch, where the sample timetables tell the cleanest story.
Classrooms show as *closed* on Sundays and outside 09:00–17:00.

---

## Sign up and the age gate

Signup is three steps: **You → Age check → Secure**.

- **Age check:** the student picks their date of birth (day/month/year, nothing pre-filled).
  The server works out the exact age (on India's date). If they're 18+,
  they get a one-time pass that's valid for 20 minutes. The date of birth is then
  discarded: it's never saved, logged or sent anywhere else.
- **Under 18:** no account is created. The student sees a clear, kind explanation
  (DPDP Act 2023). Sign-up is paused on that browser for 24 hours so they can't
  just go back and change the year.
- **Can't be skipped:** the server refuses any signup without a valid,
  unused pass from the age check, even if someone calls the API directly.

The **You** tab has a **Security & privacy** card: 18+ verified badge, active
sessions, *Sign out everywhere*, the privacy notice, and *Delete my account*.

---

## Whole campus + campus map (new)

GhostSlot now covers the whole campus, not just classrooms. Filter by **All · Study · Food · Sports · Hangout** in Find, or open the **Map** tab.

| Kind of place | Examples (real CU places) | How GhostSlot knows if it's free |
|---|---|---|
| Classrooms, labs | A2·104, CSE Lab 9, D Block LT-3 | Timetable + bookings |
| Library | D6 Library (KRC) | Campus Wi-Fi crowd (how full) |
| Food | Food Republic (Domino's, Burger Singh, Major Chang's, Roll Express), Urban King Café, The Food Scientists, Chai Nagri, The Samosa Express, Trending Food | Campus Wi-Fi crowd |
| Sports | Basketball Courts 1 & 2, Badminton Hall, Volleyball, Fitness Centre, Main Ground | Campus Wi-Fi crowd. Courts can be booked |
| Hangout | Fountain Area | Campus Wi-Fi crowd |
| Demo Room | Wi-Fi CSI demo | ESP32-S3 CSI pair (live hardware) |

- Places show **quiet / moderate / busy / closed**, how full they are, and their opening hours.
  Courts can be booked; cafés and the library are walk-in.
- **Prototype note:** campus Wi-Fi access-point counts aren't connected yet, so crowd levels are
  **simulated** with a realistic daily pattern (the lunch rush at Food Republic, the evening rush at the courts).
  `crowdAt()` in `src/campus.js` is the one function to swap for the live Wi-Fi feed.
- Everything about the places (names, hours, capacities, map positions) is in **`src/campus.js`**.
  Hours, capacities and positions are demo values, so correct them there.
- **Using the official CU map:** save it as `public/brand/campus-map.png`, set
  `CAMPUS_MAP_IMAGE = "/brand/campus-map.png"` in `src/campus.js`, then adjust each place's `x`/`y`
  so the pins sit on the right buildings. Until then the Map tab draws a schematic layout.

---

## Campus Digital Twin (new in 0.4)

Open the **Twin** tab. Everything is computed in the database
(`supabase/migrations/0002_ghostslot_twin.sql`) and served by `server/twin.js`
to signed-in users only.

| Feature | How it works |
|---|---|
| **Live campus view** | Latest 15-minute reading per room: *in use*, *free*, or *empty but powered* |
| **Classroom utilisation** | Heatmap of how often each room is used, per weekday hour |
| **Energy waste** | A slot is wasted when nobody is inside but the room draws over 25% of its rated load. Shown in kWh and ₹ (tariff in `TWIN_TARIFF_INR_PER_KWH`, default ₹8/kWh, an assumption) |
| **Water anomalies** | Robust z-score against the median + MAD for the same building, hour and weekday/weekend. Above 6 = flagged; back-to-back readings become one episode |
| **Alerts** | Rooms wasting power now + water episodes. Facilities accounts (roll numbers in `TWIN_ADMIN_ROLLS`, default: the demo account) can *Acknowledge* or *Mark resolved*; other students see them read-only |
| **Use what's already built** | Rooms used under 30% of class hours get a reallocation suggestion |

> **Data honesty:** CU's meters aren't connected yet. `gs_twin_generate()` simulates
> realistic readings (class timings, lunch dip, lights left on, night-time leaks) and
> every row is tagged `source = 'simulated'`. The app shows a *Simulated data*
> banner. The server tops up the feed every 5 minutes, and after a sleep it backfills
from the last stored reading, so there are no gaps in the history.
> Real sensor rows go in the same tables with `source = 'sensor'`.

**Setup:** run migrations `0001` to `0004` in the Supabase SQL editor (in order),
then set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Without them the Twin tab
says it isn't connected; the rest of the app still works.

---

## The logo

The logo lives in **one place**: `src/brand/BrandMark.jsx`.
When you have it: save it as `public/brand/logo.png` (square, at least 256×256)
and change `LOGO_SRC = null` to `LOGO_SRC = "/brand/logo.png"`. Every screen updates.

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

## Demo Room: Wi-Fi CSI sensing

Two ESP32-S3 boards act as a CSI transmitter/receiver pair. The backend
(`server/csi.js`) validates, smooths and compares readings against a calibrated
baseline, and reports `CALIBRATING` · `NORMAL` · `CHANGE_DETECTED` · `OFFLINE` · `UNKNOWN`.
**`CHANGE_DETECTED` means the Wi-Fi channel changed. It is not a people count.**

It runs in **simulation mode** by default (no hardware needed). For real hardware, in `server/.env`:
```
CSI_MODE=hardware
CSI_DEVICE_KEY=<a long random string, the same one flashed into the boards>
```
**New in 0.2:** every board request must send the key as a header, otherwise it is rejected:
```
POST /api/csi/demo-room
X-Device-Key: <CSI_DEVICE_KEY>
{ "nodeId": "node-a", "value": 52.3 }
```
The OLED polls `GET /api/csi/status?device=oled` with the same `X-Device-Key` header
to show as online. The calibrate and mode-switch endpoints need `X-Admin-Key: <CSI_ADMIN_KEY>`
and are switched off if no admin key is set.

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
Render asks for `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (required: accounts and the twin
live there, and Render's free disk is wiped on every deploy) and `GEMINI_API_KEY` (optional).
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
Campus Twin analysis methods were tested on public datasets: UCI Occupancy Detection (Candanedo & Feldheim, 2016)
and UCI Appliances Energy Prediction (Candanedo, Feldheim & Deramaix, 2017).
