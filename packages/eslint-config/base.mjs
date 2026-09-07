import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import boundaries from 'eslint-plugin-boundaries';

const foundation = ['auth', 'storage', 'audit', 'notifications'];
const core = ['videos', 'workflow', 'tasks', 'workers'];
const product = ['discovery', 'voice-profiles', 'review', 'publishing', 'translation', 'content'];
const allModules = [...foundation, ...core, ...product];

const layerElements = [
  { type: 'foundation', pattern: 'src/modules/{auth,storage,audit,notifications}', mode: 'folder' },
  { type: 'core', pattern: 'src/modules/{videos,workflow,tasks,workers}', mode: 'folder' },
  {
    type: 'product',
    pattern: 'src/modules/{discovery,voice-profiles,review,publishing,translation,content}',
    mode: 'folder',
  },
  { type: 'module', pattern: 'src/modules/*', mode: 'folder' },
];

const restrictedImports = (patterns, paths = []) => ({
  'no-restricted-imports': [
    'error',
    {
      ...(paths.length > 0 ? { paths } : {}),
      ...(patterns.length > 0
        ? {
            patterns: [
              { group: patterns, message: 'Import violates the documented module boundary.' },
            ],
          }
        : {}),
    },
  ],
});

export default [
  ...tseslint.configs['flat/strict'],
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tseslint, boundaries },
    settings: {
      'boundaries/elements-single-match': false,
      'boundaries/elements': layerElements,
      'import/resolver': {
        typescript: { alwaysTryTypes: true, project: './tsconfig.json' },
        node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] },
      },
    },
    rules: {
      // NestJS @Module classes are intentionally empty metadata containers.
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'boundaries/element-types': [
        'error',
        {
          default: 'allow',
          rules: [
            { from: 'foundation', disallow: ['core', 'product'] },
            { from: 'core', disallow: ['product'] },
          ],
        },
      ],
      'boundaries/entry-point': [
        'error',
        {
          default: 'disallow',
          rules: [
            { target: ['foundation', 'core', 'product'], allow: ['index.ts', '*.module.ts'] },
          ],
        },
      ],
    },
  },
  {
    files: allModules.flatMap((name) => [
      `**/src/modules/${name}/domain/**/*.ts`,
      `**/src/modules/${name}/domain/**/*.tsx`,
    ]),
    rules: restrictedImports(['@nestjs/*', '@prisma/*', 'fastify']),
  },
  {
    files: allModules.flatMap((name) => [
      `**/src/modules/${name}/application/**/*.ts`,
      `**/src/modules/${name}/application/**/*.tsx`,
    ]),
    rules: restrictedImports(
      [],
      [
        {
          name: '@nestjs/common',
          allowImportNames: ['Inject', 'Injectable', 'Optional', 'forwardRef'],
          message: 'Application may use only the documented NestJS DI decorators.',
        },
      ],
    ),
  },
];
