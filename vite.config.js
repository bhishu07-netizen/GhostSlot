import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Everything under /api goes to the GhostSlot backend (server/), which
      // holds all secrets: accounts, the age gate, Gemini and CSI sensing.
      "/api": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
  build: {
    sourcemap: false, // don't ship readable source to the public
    // Keep fonts as real files (never data: URIs) so the strict
    // Content-Security-Policy (font-src 'self') can stay tight.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
    chunkSizeWarningLimit: 900,
  },
});
