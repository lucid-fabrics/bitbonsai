import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$', '^@bitbonsai/prisma-types$'],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    rules: {},
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
    },
  },
  {
    // Allow relative package.json imports in these specific files
    files: [
      'apps/backend/src/**/settings.controller.ts',
      'apps/backend/src/**/nodes.service.ts',
      'apps/backend/src/**/node-discovery.service.ts',
      'apps/backend/src/**/health.service.ts',
      'apps/backend/src/**/health.controller.ts',
      'apps/backend/src/**/setup.service.ts',
      'apps/backend/src/**/database-init.service.ts',
      'apps/backend/src/**/logger.config.ts',
    ],
    rules: {
      '@nx/enforce-module-boundaries': 'off',
    },
  },
  {
    // Allow control characters in regex for security validation
    files: ['apps/backend/src/queue/services/file-transfer.service.ts'],
    rules: {
      'no-control-regex': 'off',
    },
  },
];
