import base from '@rswim/config/eslint';

// The worker is the one app allowed to use the org-scoped service client.
export default [...base, { rules: { 'no-restricted-imports': 'off' } }];
