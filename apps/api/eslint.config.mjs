import sharedConfig from '@reup-dubbing-studio/eslint-config';

export default [
  ...sharedConfig,
  {
    ignores: ['dist/**', 'coverage/**'],
  },
  {
    files: ['src/**/*.ts'],
    rules: { 'no-console': 'error' },
  },
  {
    files: ['test/**/*.ts', '**/test/**/*.ts'],
    // Jest's CommonJS supertest adapter is callable only through import = require.
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];
