import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// בפיתוח הדף מוגש על ידי Vite ומדבר עם השרת בפורט 3000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/ws': { target: 'ws://127.0.0.1:3000', ws: true },
    },
  },
});
