import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { fileURLToPath } from 'node:url';

// `vite build` (and Cloudflare's build step) targets production; `vite` dev uses the local database.
export default defineConfig(({ command }) => ({
  plugins: [react(), cloudflare({ configPath: command === 'build' || process.env.KAI_DEPLOY === '1' ? 'wrangler.json' : 'wrangler.local.json', inspectorPort: false })],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
}));
