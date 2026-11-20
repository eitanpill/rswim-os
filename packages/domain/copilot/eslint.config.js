import base from '@rswim/config/eslint';

export default [
  ...base,
  // A personal invite is read by its token alone, across tenants (like a payment link): only that file may.
  {
    files: ['test/**', 'src/lead-invite-public.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
];
