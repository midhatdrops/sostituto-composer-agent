import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'web'),
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    // modo dev (npm run dev:web): encaminha a API para o servidor Node
    proxy: { '/api': { target: 'http://127.0.0.1:4517', changeOrigin: true } },
  },
});
