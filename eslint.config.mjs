import sharedConfig from './packages/eslint-config/base.mjs';

export default [
  ...sharedConfig,
  {
    ignores: ['**/dist/**', '**/coverage/**', 'workers/**'],
  },
];
