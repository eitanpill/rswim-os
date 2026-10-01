import base from '@rswim/config/eslint';

export default [...base, { ignores: ['.next/**', 'next-env.d.ts', 'public/sw.js'] }];
