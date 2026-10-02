import base from '@rswim/config/eslint';

export default [...base, { files: ['test/**'], rules: { 'no-restricted-imports': 'off' } }];
