import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5191,
    open: true,
    // 127.0.0.1, not localhost: uvicorn binds IPv4 and Node would otherwise try ::1 first.
    proxy: { '/api': { target: 'http://127.0.0.1:8101', changeOrigin: true } },
  },
});
