import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import boundaries from 'eslint-plugin-boundaries';

const allModules =
  '{auth,storage,audit,notifications,videos,workflow,tasks,workers,discovery,voice-profiles,review,publishing,translation,content}';
const foundationModules = '{auth,storage,audit,notifications}';
const coreModules = '{videos,workflow,tasks,workers}';
const productModules = '{discovery,voice-profiles,review,publishing,translation,content}';
const foundationModuleNames = ['auth', 'storage', 'audit', 'notifications'];
const coreModuleNames = ['videos', 'workflow', 'tasks', 'workers'];
const productModuleNames = [
  'discovery',
  'voice-profiles',
  'review',
  'publishing',
  'translation',
  'content',
];
const relativePatterns = (names) => names.flatMap((name) => [`../${name}/**`, `../../${name}/**`]);
const foundationImportPatterns = [
  ...relativePatterns(coreModuleNames),
  ...relativePatterns(productModuleNames),
];
const coreImportPatterns = relativePatterns(productModuleNames);
const moduleInternalPatterns = [
  '../*/internal/**',
  '../../*/internal/**',
  '@reup-dubbing-studio/*/internal/**',
];

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      boundaries,
    },
    settings: {
      'boundaries/elements': [
        { type: 'foundation', pattern: `src/modules/${foundationModules}/**` },
        { type: 'core', pattern: `src/modules/${coreModules}/**` },
        { type: 'product', pattern: `src/modules/${productModules}/**` },
        { type: 'module-internal', pattern: `**/src/modules/${allModules}/internal/**/*` },
        { type: 'module', pattern: `**/src/modules/${allModules}/**/*` },
      ],
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
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
      'boundaries/no-private': 'error',
    },
  },
  {
    files: ['**/src/modules/**/domain/**/*.ts', '**/src/modules/**/domain/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@nestjs/common', message: 'Domain must not depend on NestJS.' },
            { name: '@prisma/client', message: 'Domain must not depend on Prisma.' },
            { name: 'fastify', message: 'Domain must not depend on Fastify.' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/src/modules/**/application/**/*.ts', '**/src/modules/**/application/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@nestjs/common',
              allowImportNames: ['Inject', 'Injectable', 'Optional', 'forwardRef'],
              message: 'Application may use only the documented NestJS DI decorators.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/src/modules/**/*.ts', '**/src/modules/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: moduleInternalPatterns,
              message: 'Import another module through its index.ts or *.module.ts entry point.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      `**/src/modules/${foundationModules}/**/*.ts`,
      `**/src/modules/${foundationModules}/**/*.tsx`,
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: foundationImportPatterns,
              message: 'Foundation modules may not import Core or Product modules.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [`**/src/modules/${coreModules}/**/*.ts`, `**/src/modules/${coreModules}/**/*.tsx`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: coreImportPatterns, message: 'Core modules may not import Product modules.' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/src/modules/**/domain/**/*.ts', '**/src/modules/**/domain/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@nestjs/common', message: 'Domain must not depend on NestJS.' },
            { name: '@prisma/client', message: 'Domain must not depend on Prisma.' },
            { name: 'fastify', message: 'Domain must not depend on Fastify.' },
          ],
          patterns: [
            {
              group: moduleInternalPatterns,
              message: 'Use a module entry point instead of a deep import.',
            },
          ],
        },
      ],
    },
  },
  ...foundationModuleNames.map((moduleName) => ({
    files: [`**/src/modules/${moduleName}/**/*.ts`, `**/src/modules/${moduleName}/**/*.tsx`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...foundationImportPatterns],
              message: 'Foundation modules may not import Core or Product modules.',
            },
          ],
        },
      ],
    },
  })),
  ...coreModuleNames.map((moduleName) => ({
    files: [`**/src/modules/${moduleName}/**/*.ts`, `**/src/modules/${moduleName}/**/*.tsx`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...coreImportPatterns],
              message: 'Core modules may not import Product modules.',
            },
          ],
        },
      ],
    },
  })),
  {
    files: ['**/src/modules/**/domain/**/*.ts', '**/src/modules/**/domain/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@nestjs/common', message: 'Domain must not depend on NestJS.' },
            { name: '@prisma/client', message: 'Domain must not depend on Prisma.' },
            { name: 'fastify', message: 'Domain must not depend on Fastify.' },
          ],
          patterns: [
            {
              group: moduleInternalPatterns,
              message: 'Use a module entry point instead of a deep import.',
            },
          ],
        },
      ],
    },
  },
];
