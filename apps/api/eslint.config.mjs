import baseConfig from '@reup-dubbing-studio/eslint-config';

export default [
  ...baseConfig,
  {
    ignores: ['dist/**', 'coverage/**'],
  },
];
