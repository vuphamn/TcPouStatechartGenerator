import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    watch: {
      // Build output: watching it locks packaged files (electron-builder rename fails)
      // and crashes the dev server with EBUSY while a built .exe is running
      ignored: ['**/release/**', '**/dist/**', '**/xae-extension/**'],
    },
  },
});
