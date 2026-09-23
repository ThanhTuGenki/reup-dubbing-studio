import baseConfig from '@reup-dubbing-studio/eslint-config';

export default [
  { ignores: ['src/generated/**', 'src/generated-worker/**'] },
  ...baseConfig,
];
