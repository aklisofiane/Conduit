import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envDir = path.resolve(__dirname, '../..');

export default defineConfig(({ mode }) => {
  // Drives `server.port` from WEB_PORT so scripts/preflight.ts can reallocate when
  // 5173 collides. `strictPort: true` fails loudly if the bind doesn't match — the
  // alternative (silent shift to 5174) breaks CORS and Better Auth trustedOrigins,
  // both of which are pinned to CONDUIT_CORS_ORIGIN.
  const env = loadEnv(mode, envDir, '');
  const port = Number(env.WEB_PORT) || 5173;

  return {
    plugins: [react(), tailwind()],
    // Load VITE_* from the monorepo root .env — matches what apps/api and apps/worker read.
    envDir,
    resolve: {
      alias: {
        '@conduit/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port,
      strictPort: true,
    },
  };
});
