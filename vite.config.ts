import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const DEV_TUNNEL_HOSTS = ['.ts.net', '.trycloudflare.com'];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    allowedHosts: DEV_TUNNEL_HOSTS,
  },
  preview: {
    host: '127.0.0.1',
    allowedHosts: DEV_TUNNEL_HOSTS,
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  worker: {
    format: 'es',
  },
});
