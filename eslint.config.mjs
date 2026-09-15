import sharedConfig from '@reup-dubbing-studio/eslint-config';

export default [
  { ignores: ['packages/api-contract/src/generated/**'] },
  ...sharedConfig,
];
