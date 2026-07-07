import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dedicated config for the LIBERTEX edition dev server:
//   vite --config vite.libertex.config.ts   ->  :5174, /api -> backend :8001
// Deterministic (no env-var plumbing). The primary/full instance keeps using
// vite.config.ts (:5173 -> :8000).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: "127.0.0.1",
    allowedHosts: [
      "localhost",
      "127.0.0.1",
      // Add a cloudflared domain here in Phase 2 when the Libertex tunnel goes up.
    ],
    proxy: {
      "/api": {
        target: "http://localhost:8001",
        changeOrigin: true,
      },
    },
  },
});
