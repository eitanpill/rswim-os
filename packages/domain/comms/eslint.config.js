import base from '@rswim/config/eslint';

export default [
  ...base,
  // GHL inbound intake is cross-tenant by nature (ADR-0005): it alone may use the owner connection.
  { files: ['test/**', 'src/services/intake.ts'], rules: { 'no-restricted-imports': 'off' } },
];
