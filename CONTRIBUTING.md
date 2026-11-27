# Contributing to GhostSlot

Thanks for helping improve GhostSlot. This project helps students and faculty find and book timetable-confirmed empty campus rooms.

## Before you begin

- Check existing issues before opening a new one.
- For security or privacy concerns, follow [SECURITY.md](SECURITY.md) instead of posting sensitive details publicly.
- Never commit API keys, passwords, real student data, room-booking records, or campus credentials.

## Local development

1. Install Node.js 20 or newer.
2. Run `npm run setup` to install frontend and backend dependencies.
3. Copy `server/.env.example` to `server/.env`.
4. Run `npm run dev:all` and open the local app.

## What to contribute

Useful contributions include:

- accessibility and mobile improvements;
- timetable import/export reliability;
- documentation and deployment guidance;
- tests for booking, account, consent, and privacy flows;
- institution-neutral configuration that does not include real personal data.

## Pull requests

- Keep each pull request focused.
- Explain the problem and the approach taken.
- Add or update tests when behavior changes.
- Run `npm test` and `npm run build` before opening a pull request.
- Update documentation when setup, configuration, or user-facing behavior changes.

By submitting a contribution, you agree that it may be distributed under the [Apache License 2.0](LICENSE).
