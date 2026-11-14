import base from '@rswim/config/eslint';

export default [
  ...base,
  // The card callback is cross-tenant by nature (ADR-0005): it alone may use the owner connection.
  { files: ['test/**', 'src/card-intake.ts'], rules: { 'no-restricted-imports': 'off' } },
];
