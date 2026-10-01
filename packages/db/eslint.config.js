import base from '@rswim/config/eslint';

// The db package owns the service client, so the import ban does not apply inside it.
export default [...base, { rules: { 'no-restricted-imports': 'off' } }];
