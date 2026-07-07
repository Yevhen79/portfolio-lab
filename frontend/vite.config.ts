import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The API proxy target and dev-server port are env-configurable so a second
// instance (the Libertex edition) can run alongside the primary one:
//   full     -> vite :5173  ->  backend :8000   (defaults)
//   libertex -> vite :5174  ->  backend :8001   (PL_API_TARGET + --port 5174)
const API_TARGET = process.env.PL_API_TARGET || "http://localhost:8000";
const EXTRA_HOSTS = (process.env.PL_ALLOWED_HOSTS || "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Bind to localhost only. ngrok / cloudflared run on the same host and
    // reach the dev server via 127.0.0.1, so tunnels still work while the raw
    // dev server is NOT directly exposed on the LAN / 0.0.0.0.
    host: "127.0.0.1",
    // Accept the Host header for our real tunnel domain(s) + localhost. Extra
    // hosts (e.g. a cloudflared domain for the Libertex instance) come from
    // PL_ALLOWED_HOSTS.
    allowedHosts: [
      "portfolio-lab-yevhen.ngrok-free.dev",
      "localhost",
      "127.0.0.1",
      ...EXTRA_HOSTS,
    ],
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
});
