import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En dev, proxyeamos las rutas del backend para evitar CORS (mismo origen).
// El backend (NestJS) igual habilita CORS para el despliegue del panel aparte.
const backend = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': backend,
      '/panel': backend,
    },
  },
});
