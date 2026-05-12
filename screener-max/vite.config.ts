import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const eodApiKey = process.env.EOD_API_KEY || process.env.API_KEY;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://eod.maxlong.my.id',
        changeOrigin: true,
        secure: true,
        headers: eodApiKey
          ? {
              Authorization: `Bearer ${eodApiKey}`,
            }
          : undefined,
      },
    },
  },
});
