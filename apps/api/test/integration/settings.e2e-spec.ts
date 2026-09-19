import { PrismaClient } from '@prisma/client';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Writable } from 'node:stream';

import { createApplication } from '../../src/application';
import type { AppConfig } from '../../src/platform/config/config';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('Settings API with PostgreSQL', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  const secret = 'content-agent-secret-sentinel';
  const accessKeyId = 'storage-access-key-sentinel';
  const secretAccessKey = 'storage-secret-key-sentinel';
  const idempotencyKey = '01994429-ec00-7000-8000-000000000002';
  const logChunks: string[] = [];

  beforeAll(async () => {
    const config: AppConfig = {
      nodeEnv: 'test', port: 3000, logLevel: 'info', corsOrigins: ['http://localhost:5173'],
      rateLimitMax: 100, rateLimitWindowMs: 60_000, healthRateLimitMax: 100,
      trustProxy: false, databaseUrl: databaseUrl!,
      settingsEncryptionKey: Buffer.alloc(32, 3).toString('base64'),
    };
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    await prisma.idempotencyRecord.deleteMany();
    await prisma.systemSetting.update({
      where: { singletonKey: 'DEFAULT' },
      data: { version: 1, contentAgentCredentialId: null, storageCredentialId: null },
    });
    await prisma.systemCredential.deleteMany();
    const destination = new Writable({
      write(chunk, _encoding, callback) { logChunks.push(String(chunk)); callback(); },
    });
    app = await createApplication(config, { loggerDestination: destination });
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
        storage: {
          accountId: '8f3c00000000000000000000000000a4', bucket: 'reup-dubbing-media',
          credential: { action: 'REPLACE', value: { accessKeyId, secretAccessKey } },
        },
        retention: { rawVideoDays: 14 },
      },
    };
    const updated = await app.inject(request);
    expect(updated.statusCode).toBe(200);
    expect(updated.headers.etag).toBe('"2"');
    expect(updated.body).not.toContain(secret);
    expect(updated.body).not.toContain(accessKeyId);
    expect(updated.body).not.toContain(secretAccessKey);
    expect(updated.json().data.contentAgent.credential).toMatchObject({ configured: true, hint: 'inel' });

    const stored = await prisma.systemCredential.findUniqueOrThrow({ where: { kind: 'CONTENT_AGENT_API_KEY' } });
    expect(Buffer.from(stored.encryptedPayload).toString('utf8')).not.toContain(secret);
    const storedR2 = await prisma.systemCredential.findUniqueOrThrow({ where: { kind: 'OBJECT_STORAGE_KEYPAIR' } });
    expect(Buffer.from(storedR2.encryptedPayload).toString('utf8')).not.toContain(accessKeyId);
    expect(Buffer.from(storedR2.encryptedPayload).toString('utf8')).not.toContain(secretAccessKey);

    const logs = logChunks.join('');
    expect(logs).toContain('request completed');
    expect(logs).not.toContain(secret);
    expect(logs).not.toContain(accessKeyId);
    expect(logs).not.toContain(secretAccessKey);

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
