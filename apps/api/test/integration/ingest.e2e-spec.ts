import { PrismaClient } from '@prisma/client';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApplication } from '../../src/application';
import type { AppConfig } from '../../src/platform/config/config';
import { uuidV7 } from '../../src/platform/ids/uuid-v7';
import { firstValueFrom, timeout } from 'rxjs';
import { PrismaQueueRepository } from '../../src/modules/queue/infrastructure/prisma-queue-repository';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('Ingest job API with PostgreSQL', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let accountId: string;
  let channelId: string;
  let readySourceId: string;
  let blockedSourceId: string;
  let bulkSourceIds: string[];
  let bulkJobIds: string[];

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    await prisma.taskLease.deleteMany();
    await prisma.workflowEvent.deleteMany();
    await prisma.taskAttempt.deleteMany();
    await prisma.outboxMessage.deleteMany({ where: { eventType: 'queue.invalidate' } });
    await prisma.pipelineTask.deleteMany();
    await prisma.pipelineJob.deleteMany();
    await prisma.video.deleteMany();
    await prisma.auditEvent.deleteMany({ where: { action: 'INGEST_JOBS_CREATED' } });
    await prisma.idempotencyRecord.deleteMany({ where: { scope: 'INGEST_CREATE_JOBS_V1' } });
    await prisma.idempotencyRecord.deleteMany({ where: { scope: { in: ['QUEUE_CANCEL_JOB_V1', 'QUEUE_RETRY_JOB_V1'] } } });

    const voiceId = uuidV7();
    const assetId = uuidV7();
    channelId = uuidV7();
    await prisma.voiceProfile.create({ data: {
      id: voiceId, name: `Ingest voice ${voiceId}`, normalizedName: `ingest voice ${voiceId}`,
      primaryLanguage: 'vi', status: 'READY', licenseKind: 'OWNED_RECORDING', commercialUseAllowed: true,
    } });
    await prisma.asset.create({ data: {
      id: assetId, storageBackend: 'R2', bucket: 'ingest-test', objectKey: `voices/${voiceId}/sample.wav`,
      fileName: 'sample.wav', status: 'AVAILABLE', checksumSha256: 'c'.repeat(64), byteSize: 128,
      contentType: 'audio/wav', uploadedAt: new Date(), verifiedAt: new Date(),
    } });
    await prisma.voiceProfileSample.create({ data: {
      id: uuidV7(), voiceProfileId: voiceId, assetId, language: 'vi', transcript: 'Xin chào',
      durationMs: 4000, revision: 1,
    } });
    await prisma.channelProfile.create({ data: {
      id: channelId, name: `Ingest channel ${channelId}`, normalizedName: `ingest channel ${channelId}`,
      status: 'ACTIVE', targetLanguage: 'vi', defaultVoiceProfileId: voiceId,
      subtitleLanguage: 'vi', subtitleFilenameRule: '{slug}.vi.srt', output16x9Enabled: true,
    } });

    accountId = uuidV7();
    const runId = uuidV7();
    readySourceId = uuidV7();
    blockedSourceId = uuidV7();
    bulkSourceIds = [uuidV7(), uuidV7()];
    const observedAt = new Date();
    await prisma.sourceAccount.create({ data: {
      id: accountId, platform: 'DOUYIN', displayName: 'Ingest source', status: 'ACTIVE',
      credentials: { create: {
        id: uuidV7(), kind: 'NETSCAPE_COOKIE', ciphertext: new Uint8Array([1, 2, 3]),
        encryptionKeyId: 'test', encryptedAt: observedAt,
      } },
    } });
    await prisma.discoveryRun.create({ data: {
      id: runId, sourceAccountId: accountId, mode: 'JINGXUAN', status: 'SUCCEEDED',
      finishedAt: observedAt,
    } });
    await prisma.sourceContent.createMany({ data: [
      {
        id: readySourceId, platform: 'DOUYIN', externalId: `ready-${readySourceId}`,
        contentType: 'VIDEO', title: 'Video sẵn sàng', canonicalUrl: 'https://www.douyin.com/video/safe',
        availability: 'AVAILABLE', isIngestEligible: true, firstSeenAt: observedAt, lastSeenAt: observedAt,
      },
      {
        id: blockedSourceId, platform: 'DOUYIN', externalId: `blocked-${blockedSourceId}`,
        contentType: 'NOTE', title: 'Không hỗ trợ', availability: 'AVAILABLE',
        isIngestEligible: false, firstSeenAt: observedAt, lastSeenAt: observedAt,
      },
      ...bulkSourceIds.map((id, index) => ({
        id, platform: 'DOUYIN' as const, externalId: `bulk-${id}`, contentType: 'VIDEO' as const,
        title: `Video bulk ${index + 1}`, availability: 'AVAILABLE' as const,
        isIngestEligible: true, firstSeenAt: observedAt, lastSeenAt: observedAt,
      })),
    ] });
    await prisma.discoveryItem.createMany({ data: [
      { id: uuidV7(), discoveryRunId: runId, sourceContentId: readySourceId, rank: 1, pageIndex: 0, discoveredAt: observedAt },
      { id: uuidV7(), discoveryRunId: runId, sourceContentId: blockedSourceId, rank: 2, pageIndex: 0, discoveredAt: observedAt },
      ...bulkSourceIds.map((sourceContentId, index) => ({
        id: uuidV7(), discoveryRunId: runId, sourceContentId, rank: index + 3, pageIndex: 0, discoveredAt: observedAt,
      })),
    ] });

    const config: AppConfig = {
      nodeEnv: 'test', port: 3000, logLevel: 'error', corsOrigins: ['http://localhost:5173'],
      rateLimitMax: 100, rateLimitWindowMs: 60_000, healthRateLimitMax: 100, trustProxy: false,
      databaseUrl: databaseUrl!, settingsEncryptionKey: Buffer.alloc(32, 8).toString('base64'),
    };
    app = await createApplication(config);
  });

  afterAll(async () => {
    await prisma?.taskLease.deleteMany();
    await prisma?.workflowEvent.deleteMany();
    await prisma?.taskAttempt.deleteMany();
    await prisma?.outboxMessage.deleteMany({ where: { eventType: 'queue.invalidate' } });
    await prisma?.pipelineTask.deleteMany();
    await prisma?.pipelineJob.deleteMany();
    await prisma?.video.deleteMany();
    await prisma?.auditEvent.deleteMany({ where: { action: 'INGEST_JOBS_CREATED' } });
    await prisma?.idempotencyRecord.deleteMany({ where: { scope: 'INGEST_CREATE_JOBS_V1' } });
    await prisma?.idempotencyRecord.deleteMany({ where: { scope: { in: ['QUEUE_CANCEL_JOB_V1', 'QUEUE_RETRY_JOB_V1'] } } });
    await app?.close();
    await prisma?.$disconnect();
  });

  it('preflights each selected source in request order', async () => {
    const response = await app.inject({ method: 'POST', url: '/v1/ingest/preflight', payload: {
      sourceAccountId: accountId, sourceContentIds: [readySourceId, blockedSourceId], channelProfileId: channelId,
    } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      summary: { total: 2, ready: 1, blocked: 1 },
      items: [
        { sourceContentId: readySourceId, disposition: 'READY' },
        { sourceContentId: blockedSourceId, disposition: 'SOURCE_NOT_INGEST_ELIGIBLE' },
      ],
    });
  });

  it('creates a video, immutable job snapshot and safe DOWNLOAD task idempotently', async () => {
    const payload = {
      sourceAccountId: accountId, sourceContentIds: [readySourceId, blockedSourceId], channelProfileId: channelId,
    };
    const key = 'ingest-api-retry-key-0001';
    const created = await app.inject({ method: 'POST', url: '/v1/ingest/jobs', headers: { 'idempotency-key': key }, payload });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({
      summary: { total: 2, created: 1, reused: 0, skipped: 1 },
      items: [
        { sourceContentId: readySourceId, result: 'CREATED', jobStatus: 'QUEUED', videoStatus: 'INGEST_QUEUED' },
        { sourceContentId: blockedSourceId, result: 'SKIPPED_INVALID', issues: ['SOURCE_NOT_INGEST_ELIGIBLE'] },
      ],
    });
    const firstData = created.json().data;
    const replay = await app.inject({ method: 'POST', url: '/v1/ingest/jobs', headers: { 'idempotency-key': key }, payload });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().data).toEqual(firstData);

    const video = await prisma.video.findUniqueOrThrow({ where: {
      sourceContentId_channelProfileId: { sourceContentId: readySourceId, channelProfileId: channelId },
    } });
    const job = await prisma.pipelineJob.findFirstOrThrow({ where: { videoId: video.id, kind: 'INGEST' } });
    const task = await prisma.pipelineTask.findFirstOrThrow({ where: { pipelineJobId: job.id } });
    expect(job.profileSnapshot).toMatchObject({ schemaVersion: 2, profile: { channelProfileId: channelId } });
    expect(task).toMatchObject({ taskType: 'DOWNLOAD', resourceClass: 'IO', status: 'READY', maxAttempts: 3 });
    expect(JSON.stringify(task.inputManifest)).not.toMatch(/cookie|ciphertext|signature|playback/iu);
    expect(await prisma.pipelineJob.count({ where: { videoId: video.id, kind: 'INGEST' } })).toBe(1);
    const record = await prisma.idempotencyRecord.findFirstOrThrow({ where: { scope: 'INGEST_CREATE_JOBS_V1' } });
    expect(record.key).not.toBe(key);
    expect(await prisma.auditEvent.count({ where: { action: 'INGEST_JOBS_CREATED' } })).toBe(1);
  });

  it('returns the active job for a new request and rejects key reuse with another body', async () => {
    const payload = { sourceAccountId: accountId, sourceContentIds: [readySourceId], channelProfileId: channelId };
    const duplicate = await app.inject({
      method: 'POST', url: '/v1/ingest/jobs', headers: { 'idempotency-key': 'ingest-api-duplicate-0002' }, payload,
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().data).toMatchObject({ summary: { created: 0, reused: 1 }, items: [{ result: 'ALREADY_QUEUED' }] });

    const changed = await app.inject({
      method: 'POST', url: '/v1/ingest/jobs', headers: { 'idempotency-key': 'ingest-api-duplicate-0002' },
      payload: { ...payload, sourceContentIds: [blockedSourceId] },
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('creates one video, job and DOWNLOAD task for every ready item in a bulk request', async () => {
    const response = await app.inject({
      method: 'POST', url: '/v1/ingest/jobs', headers: { 'idempotency-key': 'ingest-api-bulk-0003' },
      payload: { sourceAccountId: accountId, sourceContentIds: bulkSourceIds, channelProfileId: channelId },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      summary: { total: 2, created: 2, reused: 0, skipped: 0 },
      items: bulkSourceIds.map((sourceContentId) => ({ sourceContentId, result: 'CREATED', jobStatus: 'QUEUED' })),
    });
    bulkJobIds = response.json().data.items.map((item: { jobId: string }) => item.jobId);
    const videos = await prisma.video.findMany({ where: { sourceContentId: { in: bulkSourceIds }, channelProfileId: channelId } });
    expect(videos).toHaveLength(2);
    expect(await prisma.pipelineJob.count({ where: { videoId: { in: videos.map(({ id }) => id) }, kind: 'INGEST' } })).toBe(2);
    expect(await prisma.pipelineTask.count({ where: { pipelineJob: { videoId: { in: videos.map(({ id }) => id) } }, taskType: 'DOWNLOAD' } })).toBe(2);
  });

  it('lists safe Queue projections and supports retry/cancel with version and idempotency', async () => {
    const list = await app.inject({ method: 'GET', url: '/v1/queue/jobs?status=QUEUED&limit=2' });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.items).toHaveLength(2);
    expect(JSON.stringify(list.json())).not.toMatch(/inputManifest|cookie|ciphertext|playback/iu);

    const retryJobId = bulkJobIds[0]!;
    const retryTask = await prisma.pipelineTask.findFirstOrThrow({ where: { pipelineJobId: retryJobId } });
    await prisma.pipelineTask.update({ where: { id: retryTask.id }, data: { status: 'FAILED', attemptCount: 3 } });
    await prisma.pipelineJob.update({ where: { id: retryJobId }, data: { status: 'FAILED', failureCode: 'DOWNLOAD_TIMEOUT', failureDetailSafe: 'Provider timeout', finishedAt: new Date(), version: { increment: 1 } } });
    const failed = await app.inject({ method: 'GET', url: `/v1/queue/jobs/${retryJobId}` });
    expect(failed.statusCode).toBe(200);
    expect(failed.headers.etag).toBe('"2"');
    expect(failed.json().data.actions).toEqual({ canRetry: true, canCancel: false });
    const retryHeaders = { 'if-match': '"2"', 'idempotency-key': 'queue-retry-test-0001' };
    const retried = await app.inject({ method: 'POST', url: `/v1/queue/jobs/${retryJobId}/retry`, headers: retryHeaders, payload: { taskId: retryTask.id, reason: 'Manual retry' } });
    expect(retried.statusCode).toBe(200);
    expect(retried.headers.etag).toBe('"3"');
    expect(retried.json().data).toMatchObject({ status: 'QUEUED', version: 3, failure: null });
    const replay = await app.inject({ method: 'POST', url: `/v1/queue/jobs/${retryJobId}/retry`, headers: retryHeaders, payload: { taskId: retryTask.id, reason: 'Manual retry' } });
    expect(replay.json().data).toEqual(retried.json().data);

    const cancelJobId = bulkJobIds[1]!;
    const cancelled = await app.inject({ method: 'POST', url: `/v1/queue/jobs/${cancelJobId}/cancel`, headers: { 'if-match': '"1"', 'idempotency-key': 'queue-cancel-test-0002' }, payload: { reason: 'Operator cancelled' } });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().data).toMatchObject({ status: 'CANCELLED', version: 2 });
    expect(await prisma.workflowEvent.count({ where: { pipelineJobId: { in: bulkJobIds } } })).toBe(2);
    expect(await prisma.outboxMessage.count({ where: { aggregateId: { in: bulkJobIds }, eventType: 'queue.invalidate' } })).toBe(2);
  });

  it('streams only safe Queue invalidation payloads written after connection', async () => {
    const repository = new PrismaQueueRepository(prisma);
    const eventPromise = firstValueFrom(repository.events().pipe(timeout(2_500)));
    const eventId = uuidV7();
    const job = await prisma.pipelineJob.findUniqueOrThrow({ where: { id: bulkJobIds[0]! } });
    await prisma.outboxMessage.create({ data: {
      id: eventId, aggregateType: 'PIPELINE_JOB', aggregateId: job.id, eventType: 'queue.invalidate',
      payloadSafe: { entity: 'JOB', jobId: job.id, jobVersion: job.version, reason: 'STATUS_CHANGED' },
    } });
    await expect(eventPromise).resolves.toEqual({
      id: eventId, type: 'queue.invalidate',
      data: { entity: 'JOB', jobId: job.id, jobVersion: job.version, reason: 'STATUS_CHANGED' },
    });
  });
});
