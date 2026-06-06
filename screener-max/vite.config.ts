import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const configDir = dirname(fileURLToPath(import.meta.url));

function getEodApiKey(mode: string) {
  const appEnv = loadEnv(mode, configDir, '');
  const rootEnv = loadEnv(mode, resolve(configDir, '..'), '');
  return (
    process.env.EOD_API_KEY ||
    process.env.API_KEY ||
    process.env.api_key_endpoint_eoddanbroksum ||
    appEnv.EOD_API_KEY ||
    appEnv.API_KEY ||
    appEnv.api_key_endpoint_eoddanbroksum ||
    rootEnv.EOD_API_KEY ||
    rootEnv.API_KEY ||
    rootEnv.api_key_endpoint_eoddanbroksum
  );
}

export default defineConfig(({ mode }) => {
  const eodApiKey = getEodApiKey(mode);

  return {
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
  };
});
