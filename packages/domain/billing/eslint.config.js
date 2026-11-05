import base from '@rswim/config/eslint';

export default [
  ...base,
  // Grow webhook and checkout intake are cross-tenant by nature (ADR-0005): they alone may use the owner connection.
  {
    files: ['test/**', 'src/services/webhook.ts', 'src/services/checkout-intake.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
];
