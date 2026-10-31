import base from '@rswim/config/eslint';

export default [
  ...base,
  // The online checkout confirms a paid booking as the system for one club: it alone may use withOrg.
  { files: ['test/**', 'src/services/checkout.ts'], rules: { 'no-restricted-imports': 'off' } },
];
