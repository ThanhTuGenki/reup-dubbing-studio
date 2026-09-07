import sharedConfig from '@reup-dubbing-studio/eslint-config';

export default [
  ...sharedConfig,
  {
    ignores: ['dist/**', 'coverage/**'],
  },
];
