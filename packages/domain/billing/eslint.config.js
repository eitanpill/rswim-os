import base from '@rswim/config/eslint';

export default [
  ...base,
  // Grow webhook intake is cross-tenant by nature (ADR-0005): it alone may use the owner connection.
  { files: ['test/**', 'src/services/webhook.ts'], rules: { 'no-restricted-imports': 'off' } },
];
