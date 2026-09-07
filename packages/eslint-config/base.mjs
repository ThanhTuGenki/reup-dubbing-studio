import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import boundaries from 'eslint-plugin-boundaries';

const foundation = ['auth', 'storage', 'audit', 'notifications'];
const core = ['videos', 'workflow', 'tasks', 'workers'];
const product = ['discovery', 'voice-profiles', 'review', 'publishing', 'translation', 'content'];
const allModules = [...foundation, ...core, ...product];
const relativePatterns = (names) => names.flatMap((name) => [`../${name}/**`, `../../${name}/**`]);
const internalPatterns = ['../*/internal/**', '../../*/internal/**'];
const moduleImportPatterns = [
  ...internalPatterns,
  ...allModules.flatMap((name) => [
    `../${name}/domain/**`,
    `../../${name}/domain/**`,
    `../${name}/application/**`,
    `../../${name}/application/**`,
    `../${name}/**/!(index|*.module)`,
    `../../${name}/**/!(index|*.module)`,
  ]),
];

const layerElements = [{ type: 'module', pattern: 'src/modules/*', mode: 'folder' }];

const restrictedImports = (patterns, paths = []) => ({
  'no-restricted-imports': [
    'error',
    {
      ...(paths.length > 0 ? { paths } : {}),
      patterns: [{ group: patterns, message: 'Import through the documented module boundary.' }],
    },
  ],
});

const layerConfig = (names, forbidden) => ({
  files: names.flatMap((name) => [
    `**/src/modules/${name}/**/*.ts`,
    `**/src/modules/${name}/**/*.tsx`,
  ]),
  rules: restrictedImports([...forbidden, ...moduleImportPatterns]),
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
    settings: { 'boundaries/elements': layerElements },
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
        { default: 'disallow', rules: [{ target: 'module', allow: ['index.ts', '*.module.ts'] }] },
      ],
    },
  },
  layerConfig(foundation, [...relativePatterns(core), ...relativePatterns(product)]),
  layerConfig(core, relativePatterns(product)),
  layerConfig(product, []),
  {
    files: allModules.flatMap((name) => [
      `**/src/modules/${name}/domain/**/*.ts`,
      `**/src/modules/${name}/domain/**/*.tsx`,
    ]),
    rules: restrictedImports(
      [...relativePatterns(allModules), ...moduleImportPatterns, '@nestjs/*', '@prisma/*'],
      [
        { name: '@nestjs/common', message: 'Domain must not depend on NestJS.' },
        { name: '@prisma/client', message: 'Domain must not depend on Prisma.' },
        { name: 'fastify', message: 'Domain must not depend on Fastify.' },
      ],
    ),
  },
  {
    files: allModules.flatMap((name) => [
      `**/src/modules/${name}/application/**/*.ts`,
      `**/src/modules/${name}/application/**/*.tsx`,
    ]),
    rules: restrictedImports(
      [...relativePatterns(allModules), ...moduleImportPatterns],
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
