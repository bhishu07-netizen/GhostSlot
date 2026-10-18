# GhostSlot legal checklist (v0.4)

These are the six checks Team COGNIX applies to every project, plus India's DPDP Act 2023.

| # | Check | Status in GhostSlot | Where |
|---|---|---|---|
| 1 | **Age gate at signup** | ✅ Done. Neutral date-of-birth screen with nothing pre-filled and no cut-off shown in advance. The **server** decides; 18+ only; a single-use pass is required to sign up; under-18 is blocked with a 24-hour retry lock; the date of birth is **never stored** | `server/auth.js`, `src/auth/AuthScreen.jsx` |
| 2 | **Self-hosted fonts** (not from Google's servers) | ✅ Done. Inter, Space Grotesk and JetBrains Mono are bundled via `@fontsource`. All Google Fonts `@import`s were removed, and the CSP `font-src 'self'` blocks any remote font | `src/main.jsx`, `server/index.js` |
| 3 | **Session replay off** (or consent + input masking) | ✅ Done. No session-replay, analytics or tracking tools at all. The CSP (`script-src 'self'`, `connect-src 'self'`) stops any from being added by accident | `server/index.js` |
| 4 | **Unsubscribe link + postal address in marketing emails** | ➖ Not applicable. GhostSlot sends no emails. If you add marketing emails later, every one must have a one-click unsubscribe link and your postal address | |
| 5 | **Renewal terms next to the subscribe button** | ➖ Not applicable. GhostSlot is free, with no subscriptions or payments. If you add a paid plan, show the price, renewal period and how to cancel right next to the button | |
| 6 | **DMCA agent if users can upload content** | ➖ Not needed today. The only upload is a timetable CSV, which is read **inside the student's own browser** and never published or shown to other users. If you later let users post content others can see, register a DMCA agent (and, for India, follow the IT Rules 2021 grievance process) | `src/App.jsx` (CSV import) |

## India: DPDP Act 2023

- **Children (s.9):** anyone under 18 is a child, and processing their data needs verifiable parental consent. GhostSlot doesn't collect parental consent, so it **doesn't create accounts for under-18s**. That's what the age gate enforces.
- **Notice and consent (s.5–6):** a plain-language privacy notice is shown at signup, and the student must tick to agree. It's always reachable from the login screen and the You tab.
- **Data minimisation (s.6, s.8):** only name, roll number, password hash, an "18+ verified" flag and timestamps are kept. No birth date, location or contacts.
- **Erasure (s.12):** *Delete my account* in the You tab removes the account and every session immediately.
- **Security safeguards (s.8(5)):** see [SECURITY.md](SECURITY.md).
- **Campus Twin:** stores room-level counts and meter readings only, never who was in a room. No personal data is added.
- **Grievance (s.13):** a contact is listed in the notice. Add a real email before launch.

This is a practical checklist, not legal advice.
