/* global module */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'core-does-not-import-framework-or-io',
      severity: 'error',
      from: { path: '^apps/api/src/modules/[^/]+/(?:domain|application)(?:/|$)' },
      to: {
        path: 'node_modules/(?:@nestjs|fastify|@prisma|prisma|bullmq|ioredis|@aws-sdk|kafkajs|amqplib)(?:/|$)',
      },
    },
    {
      name: 'infrastructure-does-not-import-http',
      severity: 'error',
      from: { path: '^apps/api/src/modules/[^/]+/infrastructure(?:/|$)' },
      to: { path: '^apps/api/src/modules/[^/]+/http(?:/|$)' },
    },
    {
      name: 'platform-does-not-import-business-modules',
      severity: 'error',
      from: { path: '^apps/api/src/platform(?:/|$)' },
      to: { path: '^apps/api/src/modules(?:/|$)' },
    },
    {
      name: 'outside-code-does-not-deep-import-modules',
      severity: 'error',
      from: { pathNot: '^apps/api/src/modules(?:/|$)' },
      to: { path: '^apps/api/src/modules/[^/]+/.+' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(?:^|/)dist(?:/|$)' },
    enhancedResolveOptions: {
      conditionNames: ['types', 'import', 'require', 'node', 'default'],
      exportsFields: ['exports'],
    },
  },
};
