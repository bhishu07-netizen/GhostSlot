# GhostSlot

AI-powered Campus Space Intelligence System — CU BharatX 2026 hackathon project.

## Run it locally (VS Code)

1. Unzip this folder, open it in VS Code: `File → Open Folder`.
2. Open the built-in terminal (`` Ctrl+` `` / `` Cmd+` ``) and run:
   ```bash
   npm install
   npm run dev
   ```
3. Open the URL it prints (usually `http://localhost:5173`).

All data right now (rooms, users, timetables) is mock/in-memory — it resets on refresh. That's the next thing to wire up to a real backend.

## Push to GitHub

From the project folder, in the same terminal:

```bash
git init
git add .
git commit -m "Initial commit: GhostSlot prototype"
```

Then create an empty repo on GitHub (no README/gitignore, so it doesn't conflict), and:

```bash
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo-name>.git
git push -u origin main
```

If it asks for login, use a GitHub personal access token as the password (Settings → Developer settings → Personal access tokens), not your account password.
