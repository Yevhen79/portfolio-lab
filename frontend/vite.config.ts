import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Allow access from Cloudflare quick tunnels and any LAN host
    allowedHosts: [".trycloudflare.com", ".loca.lt", ".ngrok.io", ".ngrok-free.app", "localhost"],
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
