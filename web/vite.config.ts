import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const fixtures = fileURLToPath(new URL('../data/fixtures', import.meta.url));

// Adam's server (server.mjs) serves web/dist at / and handles /api, /stream and /mock on the same origin.
// In dev we proxy those to it, so the app never needs CORS or absolute URLs.
// Against the deployed server: FLATRADAR_API=https://flatradar-u7ei.onrender.com npm run dev
const target = process.env.FLATRADAR_API ?? 'http://127.0.0.1:3000';
const backend = { target, changeOrigin: true, secure: true }; // changeOrigin: Render routes by Host header

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@fixtures': fixtures } },
  server: {
    port: 5173,
    fs: { allow: ['..'] }, // fixtures live in ../data/fixtures (single source of truth)
    proxy: {
      '/api': backend,
      '/mock': backend,
      '/stream': { ...backend, headers: { Accept: 'text/event-stream' } },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
});
