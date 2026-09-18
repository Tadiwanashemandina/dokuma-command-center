import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

/**
 * The API origin is only ever used by the dev proxy, which runs in Node —
 * it is NOT a VITE_* variable and so never reaches the browser bundle.
 * In the browser, every request goes to a same-origin relative path
 * (`/api/...`), which the proxy forwards in dev and the hosting origin
 * serves in production. No production URL is hardcoded anywhere.
 */
const API_TARGET = process.env.API_PROXY_TARGET ?? "http://localhost:4000";

export default defineConfig({
  // Tailwind v4 runs as a Vite plugin rather than through PostCSS, matching
  // the legacy app's CSS-first setup (no tailwind.config.js — the theme is
  // declared in src/styles/globals.css).
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
