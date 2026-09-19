import sharedConfig from '@reup-dubbing-studio/eslint-config';

export default [
  {
    ignores: [
      'packages/api-contract/src/generated/**',
      'Project-As-Complete-Opendesign-Design-System/**',
    ],
  },
  ...sharedConfig,
];
