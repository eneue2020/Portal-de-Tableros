import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = 'http://localhost:' + (process.env.PORT || 3000);

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': API, '/ver': API, '/canvan': API },
  },
});
