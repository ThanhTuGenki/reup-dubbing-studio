import { PrismaClient } from '@prisma/client';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApplication } from '../../src/application';
import type { AppConfig } from '../../src/platform/config/config';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('Settings API with PostgreSQL', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  const secret = 'content-agent-secret-sentinel';
  const idempotencyKey = '01994429-ec00-7000-8000-000000000002';

  beforeAll(async () => {
    const config: AppConfig = {
      nodeEnv: 'test', port: 3000, logLevel: 'fatal', corsOrigins: ['http://localhost:5173'],
      rateLimitMax: 100, rateLimitWindowMs: 60_000, healthRateLimitMax: 100,
      trustProxy: false, databaseUrl: databaseUrl!,
      settingsEncryptionKey: Buffer.alloc(32, 3).toString('base64'),
    };
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    await prisma.idempotencyRecord.deleteMany();
    await prisma.systemSetting.update({
      where: { singletonKey: 'DEFAULT' },
      data: { version: 1, contentAgentCredentialId: null },
    });
    await prisma.systemCredential.deleteMany();
    app = await createApplication(config);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('reads defaults, encrypts a replacement, replays idempotently and rejects stale writes', async () => {
    const initial = await app.inject({ method: 'GET', url: '/v1/settings' });
    expect(initial.statusCode).toBe(200);
    expect(initial.headers.etag).toBe('"1"');

    const request = {
      method: 'PATCH' as const,
      url: '/v1/settings',
      headers: { 'if-match': '"1"', 'idempotency-key': idempotencyKey },
      payload: {
        contentAgent: { provider: 'OPENAI', model: 'gpt-5.2', credential: { action: 'REPLACE', value: secret } },
        retention: { rawVideoDays: 14 },
      },
    };
    const updated = await app.inject(request);
    expect(updated.statusCode).toBe(200);
    expect(updated.headers.etag).toBe('"2"');
    expect(updated.body).not.toContain(secret);
    expect(updated.json().data.contentAgent.credential).toMatchObject({ configured: true, hint: 'inel' });

    const stored = await prisma.systemCredential.findUniqueOrThrow({ where: { kind: 'CONTENT_AGENT_API_KEY' } });
    expect(Buffer.from(stored.encryptedPayload).toString('utf8')).not.toContain(secret);

    const replay = await app.inject(request);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.version).toBe(2);

    const conflict = await app.inject({
      ...request,
      headers: { 'if-match': '"1"', 'idempotency-key': '01994429-ec00-7000-8000-000000000003' },
      payload: { retention: { rawVideoDays: 15 } },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
  });
});
