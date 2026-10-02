import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/policies.ts'],
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
});
