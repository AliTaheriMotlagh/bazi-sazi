import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const API = process.env.API_URL ?? 'http://localhost:8787';

/** Dev parity with production: <slug>.localhost:5173 serves the game player. */
function gameSubdomains(): Plugin {
  return {
    name: 'bazi-game-subdomains',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const host = (req.headers.host ?? '').split(':')[0];
        const isGameHost = host.endsWith('.localhost') && host !== 'localhost';
        const isPage = req.method === 'GET' && !/^\/(api|files|ws|@|src|node_modules|assets)\b/.test(req.url ?? '') && !/\.\w+(\?|$)/.test(req.url ?? '');
        if ((isGameHost && isPage) || req.url?.startsWith('/embed/')) req.url = '/player.html';
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), gameSubdomains()],
  // Deep imports into Monaco's ESM build (see src/editor/monacoSlim.ts).
  resolve: { alias: { '@monaco': fileURLToPath(new URL('../../node_modules/monaco-editor/esm/vs', import.meta.url)) } },
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['.localhost'],
    proxy: {
      '/api': API,
      '/files': API,
      '/ws': { target: API.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: { main: 'index.html', player: 'player.html' },
    },
  },
  worker: { format: 'es' },
});
