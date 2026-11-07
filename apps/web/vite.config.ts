import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const contracts = fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  // The shared contract is bundled from source, so the web build needs no separate package build.
  resolve: { alias: { '@catalogue/contracts': contracts } },
  server: {
    port: 5173,
    // The browser only ever talks to its own origin; /api is forwarded to the API in development.
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
});
