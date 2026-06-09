import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Bind to localhost only. ngrok runs on the same host and reaches the
    // dev server via 127.0.0.1, so the public tunnel still works while the
    // raw dev server is NOT directly exposed on the LAN / 0.0.0.0.
    host: "127.0.0.1",
    // Only accept the Host header for our real tunnel domain (+ localhost).
    // The previous broad wildcard list let any *.ngrok / *.trycloudflare
    // host proxy into the dev server.
    allowedHosts: ["portfolio-lab-yevhen.ngrok-free.dev", "localhost", "127.0.0.1"],
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
