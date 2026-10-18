// Starts the backend (server/) and the frontend (Vite) together.
// Works on Mac, Windows and Linux:  npm run dev:all
import { spawn } from "node:child_process";

const procs = [
  ["server", "npm", ["--prefix", "server", "run", "dev"]],
  ["web", "npm", ["run", "dev"]],
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  const tag = name === "server" ? "\x1b[90m[server]\x1b[0m " : "\x1b[37m[web]\x1b[0m    ";
  for (const s of [p.stdout, p.stderr]) s.on("data", (d) => process.stdout.write(String(d).replace(/^/gm, tag)));
  return p;
});
const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
