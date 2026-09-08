import sharedConfig from '@reup-dubbing-studio/eslint-config';

export default [
  ...sharedConfig,
  {
    ignores: ['dist/**', 'coverage/**'],
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  {
    files: ['src/**/domain/**/*.ts', 'src/**/domain/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nestjs/*', '@prisma/*', 'fastify'],
              message: 'Domain code must remain framework independent.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/application/**/*.ts', 'src/**/application/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@nestjs/common',
              allowImportNames: ['Inject', 'Injectable', 'Optional', 'forwardRef'],
              message: 'Application may use only documented NestJS DI decorators.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: { 'no-console': 'error' },
  },
  {
    files: ['test/**/*.ts', '**/test/**/*.ts', 'apps/api/test/**/*.ts'],
    // Jest's CommonJS supertest adapter is callable only through import = require.
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];
