import path from 'node:path';
import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react()],
  server: { host: '127.0.0.1', port: 3000, strictPort: true },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, '.') },
  },
});
