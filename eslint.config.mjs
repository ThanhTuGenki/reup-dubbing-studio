import sharedConfig from '@reup-dubbing-studio/eslint-config';

export default [
  {
    ignores: [
      'packages/api-contract/src/generated/**',
      'packages/api-contract/src/generated-worker/**',
      'Project-As-Complete-Opendesign-Design-System/**',
      '**/.venv/**',
    ],
  },
  ...sharedConfig,
];
