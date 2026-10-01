import base from '@rswim/config/eslint';

// src/worker.ts is the worker-side half of this module and may use the service client.
export default [
  ...base,
  { files: ['src/worker.ts', 'test/**'], rules: { 'no-restricted-imports': 'off' } },
];
