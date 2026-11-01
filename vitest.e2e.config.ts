import { defineConfig } from 'vitest/config';

/** Browser tests (real Chrome against the real server). Run with `npm run e2e`. */
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 90_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
