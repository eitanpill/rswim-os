// Shared flat ESLint config for every package.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Physical-direction Tailwind classes break RTL. Use logical ones (ms-/me-/ps-/pe-/start-/end-/text-start).
const PHYSICAL_DIRECTION =
  '/(^|\\s)(-?(ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|scroll-ml|scroll-mr)-|text-left|text-right|float-left|float-right)/';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=${PHYSICAL_DIRECTION}]`,
          message:
            'RTL: use logical Tailwind classes (ms-/me-/ps-/pe-/start-/end-/text-start/text-end).',
        },
        {
          selector: `TemplateElement[value.raw=${PHYSICAL_DIRECTION}]`,
          message:
            'RTL: use logical Tailwind classes (ms-/me-/ps-/pe-/start-/end-/text-start/text-end).',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@rswim/*/src/*', '@rswim/domain-*/schema*'],
              message:
                'Import a package through its public exports (services/events), never its internals.',
            },
            {
              group: ['@rswim/db/service'],
              message:
                'The RLS-bypassing service client is only for the worker and webhooks. Use withOrg().',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/test/**', '**/*.test.ts', '**/e2e/**'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
