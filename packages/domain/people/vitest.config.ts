import { defineConfig } from 'vitest/config';

// Services only; covered by integration tests against a throwaway database.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 60_000 } });
