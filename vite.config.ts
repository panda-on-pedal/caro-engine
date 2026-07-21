import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  root: rootDir,
  publicDir: false,
  build: {
    outDir: 'dist/ui',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(rootDir, 'index.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:2026',
    },
  },
});
