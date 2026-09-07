import sharedConfig from '../../packages/eslint-config/base.mjs';

export default [
  ...sharedConfig,
  {
    ignores: ['dist/**', 'coverage/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@reup-dubbing-studio/api', message: 'Web must not import API internals.' },
          ],
          patterns: [
            {
              group: ['../api/**', '../../api/**', '../../../apps/api/**', 'apps/api/**'],
              message: 'Web must not import API internals.',
            },
          ],
        },
      ],
    },
  },
];
