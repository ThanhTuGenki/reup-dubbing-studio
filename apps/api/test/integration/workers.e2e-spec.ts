import { PrismaClient } from '@prisma/client';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApplication } from '../../src/application';
import type { AppConfig } from '../../src/platform/config/config';
import { uuidV7 } from '../../src/platform/ids/uuid-v7';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('GPU Worker Control Plane with PostgreSQL', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  const digest = `sha256:${'a'.repeat(64)}`;
  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    const config: AppConfig = { nodeEnv: 'test', port: 3000, logLevel: 'error', corsOrigins: ['http://localhost:5173'], rateLimitMax: 100, rateLimitWindowMs: 60_000, healthRateLimitMax: 100, trustProxy: false, databaseUrl: databaseUrl!, settingsEncryptionKey: Buffer.alloc(32, 8).toString('base64') };
    app = await createApplication(config);
  });
  afterAll(async () => { await app?.close(); await prisma?.$disconnect(); });

  it('registers, enrolls, heartbeats and drains without persisting bearer secrets', async () => {
    const imageResponse = await app.inject({ method: 'POST', url: '/v1/worker-images', headers: { 'idempotency-key': 'worker-image-create-0001' }, payload: { role: 'BATCH_MEDIA', semanticVersion: '1.0.0', imageDigest: digest, registryRef: 'ghcr.io/example/media@sha256:aaaaaaaa', contractVersion: 1 } });
    expect(imageResponse.statusCode).toBe(201);
    const image = imageResponse.json().data;
    const createResponse = await app.inject({ method: 'POST', url: '/v1/workers', headers: { 'idempotency-key': 'worker-create-0001' }, payload: { displayName: 'Ezy batch 01', role: 'BATCH_MEDIA', provider: 'EzyCloudX', providerInstanceId: 'ctr-safe-01', expectedGpuModel: 'RTX 3090', expectedVramMb: 24_000, approvedImageId: image.id, hourlyRateCp: '15000.000000', paidVndPerCp: '1.25000000', billingStartedAt: new Date().toISOString() } });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json().data;
    const token = created.enrollment.token as string;
    expect(token).toMatch(/^enr_/u);
    const storedToken = await prisma.workerEnrollmentToken.findFirstOrThrow({ where: { workerId: created.worker.id } });
    expect(storedToken.tokenHash).not.toContain(token);
    expect(JSON.stringify(await prisma.idempotencyRecord.findFirstOrThrow({ where: { scope: 'WORKER_CREATE_V1' } }))).not.toContain(token);

    const identity = { sessionNonce: uuidV7(), role: 'BATCH_MEDIA', imageDigest: digest, agentVersion: '1.0.0', contractVersion: 1, gpuInventory: [{ model: 'RTX 3090', vramMb: 24576 }], cpuInventory: { cores: 16 }, capacity: { GPU_BATCH: { total: 1, available: 1 } } };
    const enroll = await app.inject({ method: 'POST', url: '/worker/v1/enroll', headers: { authorization: `Bearer ${token}` }, payload: identity });
    expect(enroll.statusCode).toBe(201);
    const enrolled = enroll.json().data;
    expect(enrolled.credential).toMatch(/^wrk_/u);
    const storedCredential = await prisma.workerCredential.findFirstOrThrow({ where: { workerId: created.worker.id } });
    expect(storedCredential.credentialHash).not.toContain(enrolled.credential);

    const heartbeat = { sequence: '1', sentAt: new Date().toISOString(), capacity: { GPU_BATCH: { total: 1, available: 1 } }, currentTaskCount: 0, activeLeaseIds: [], telemetry: { gpuUtilPercent: 0, temperatureC: 36 }, agentVersion: '1.0.0', contractVersion: 1 };
    const beat = await app.inject({ method: 'POST', url: `/worker/v1/sessions/${enrolled.session.id}/heartbeat`, headers: { authorization: `Bearer ${enrolled.credential}`, 'idempotency-key': 'worker-heartbeat-0001' }, payload: heartbeat });
    expect(beat.statusCode).toBe(201);
    expect(beat.json().data.acceptedSequence).toBe('1');
    await app.inject({ method: 'POST', url: `/worker/v1/sessions/${enrolled.session.id}/heartbeat`, headers: { authorization: `Bearer ${enrolled.credential}`, 'idempotency-key': 'worker-heartbeat-0001' }, payload: { ...heartbeat, sequence: '0' } });
    expect((await prisma.workerSession.findUniqueOrThrow({ where: { id: enrolled.session.id } })).lastHeartbeatSequence).toBe(1n);

    const current = (await app.inject({ method: 'GET', url: `/v1/workers/${created.worker.id}` })).json().data;
    const drain = await app.inject({ method: 'POST', url: `/v1/workers/${created.worker.id}/drain`, headers: { 'if-match': `"${current.version}"`, 'idempotency-key': 'worker-drain-0001' } });
    expect(drain.statusCode).toBe(200);
    expect(drain.json().data).toMatchObject({ desiredStatus: 'DRAINING', observedStatus: 'SAFE_TO_TERMINATE', safeToTerminate: true });
    const drained = drain.json().data;
    const terminated = await app.inject({ method: 'POST', url: `/v1/workers/${created.worker.id}/confirm-termination`, headers: { 'if-match': `"${drained.version}"`, 'idempotency-key': 'worker-terminate-0001' } });
    expect(terminated.statusCode).toBe(200);
    expect(terminated.json().data.observedStatus).toBe('TERMINATED');
    expect(await prisma.workerBillingSession.count({ where: { workerId: created.worker.id, billingEndedAt: null } })).toBe(0);
  });
});
