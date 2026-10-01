import base from '@rswim/config/eslint';

// Seeding is platform plumbing: it writes as the database owner.
export default [...base, { rules: { 'no-restricted-imports': 'off' } }];
