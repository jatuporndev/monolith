import { defineConfig } from 'vite';
export default defineConfig({
  server: { host: '127.0.0.1', port: 5199, strictPort: true, open: false },
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
});
