import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApplication } from '../../src/application';
import { ProfilesService } from '../../src/modules/profiles/application/profiles.service';
import { PrismaProfileRepository } from '../../src/modules/profiles/infrastructure/prisma-profile-repository';
import type { AppConfig } from '../../src/platform/config/config';
import { uuidV7 } from '../../src/platform/ids/uuid-v7';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('Review Policy API with PostgreSQL', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  const channelId = uuidV7();
  const seriesId = uuidV7();
  const voiceId = uuidV7();
  const assetId = uuidV7();
  const userId = uuidV7();
  const sourceId = uuidV7();
  const videoId = uuidV7();
  const jobId = uuidV7();

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    await prisma.systemSetting.update({ where: { singletonKey: 'DEFAULT' }, data: {
      rawVideoDays: 7, intermediateDays: 3, taskLogDays: 30, finalOutputDays: 90,
    } });
    await prisma.user.create({ data: { id: userId, displayName: 'Review policy test' } });
    await prisma.asset.create({ data: {
      id: assetId, storageBackend: 'R2', bucket: 'review-policy-test', objectKey: `voices/${voiceId}/sample.wav`,
      fileName: 'sample.wav', status: 'AVAILABLE', checksumSha256: 'e'.repeat(64), byteSize: 128,
      contentType: 'audio/wav', uploadedAt: new Date(), verifiedAt: new Date(),
    } });
    await prisma.voiceProfile.create({ data: {
      id: voiceId, name: `Review voice ${voiceId}`, normalizedName: `review voice ${voiceId}`,
      primaryLanguage: 'vi', status: 'READY', licenseKind: 'OWNED_RECORDING', commercialUseAllowed: true,
      samples: { create: { id: uuidV7(), assetId, language: 'vi', transcript: 'Xin chào', durationMs: 3000, revision: 1 } },
    } });
    await prisma.channelProfile.create({ data: {
      id: channelId, name: 'Review channel', normalizedName: `review-channel-${channelId}`,
      status: 'ACTIVE', targetLanguage: 'vi', defaultVoiceProfileId: voiceId,
      subtitleLanguage: 'vi', subtitleFilenameRule: '{slug}.vi.srt',
      reviewPolicy: { create: {
        id: uuidV7(), castGate: 'NOT_REQUIRED', scriptGate: 'MANUAL_REQUIRED',
        ttsGate: 'MANUAL_REQUIRED', renderGate: 'MANUAL_REQUIRED',
        publishContentGate: 'MANUAL_REQUIRED', autoRequestRender: false,
      } },
    } });
    await prisma.seriesProfile.create({ data: {
      id: seriesId, channelProfileId: channelId, name: 'Review series',
      normalizedName: `review-series-${seriesId}`, status: 'ACTIVE',
      reviewPolicy: { create: { id: uuidV7() } },
    } });
    const observedAt = new Date();
    await prisma.sourceContent.create({ data: {
      id: sourceId, platform: 'DOUYIN', externalId: `review-${sourceId}`, contentType: 'VIDEO',
      availability: 'AVAILABLE', firstSeenAt: observedAt, lastSeenAt: observedAt,
    } });
    await prisma.video.create({ data: {
      id: videoId, sourceContentId: sourceId, channelProfileId: channelId, seriesProfileId: seriesId,
      status: 'AWAITING_REVIEW', sourceLanguage: 'zh', targetLanguage: 'vi', createdById: userId,
    } });
    const config: AppConfig = {
      nodeEnv: 'test', port: 3000, logLevel: 'fatal', corsOrigins: ['http://localhost:5173'],
      rateLimitMax: 100, rateLimitWindowMs: 60_000, healthRateLimitMax: 100,
      trustProxy: false, databaseUrl: databaseUrl!,
      settingsEncryptionKey: Buffer.alloc(32, 9).toString('base64'),
    };
    app = await createApplication(config);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.pipelineJob.deleteMany({ where: { id: jobId } });
    await prisma?.video.deleteMany({ where: { id: videoId } });
    await prisma?.sourceContent.deleteMany({ where: { id: sourceId } });
    await prisma?.reviewPolicy.deleteMany({ where: { OR: [{ channelProfileId: channelId }, { seriesProfileId: seriesId }] } });
    await prisma?.seriesProfile.deleteMany({ where: { id: seriesId } });
    await prisma?.channelProfile.deleteMany({ where: { id: channelId } });
    await prisma?.voiceProfileSample.deleteMany({ where: { voiceProfileId: voiceId } });
    await prisma?.voiceProfile.deleteMany({ where: { id: voiceId } });
    await prisma?.asset.deleteMany({ where: { id: assetId } });
    await prisma?.user.deleteMany({ where: { id: userId } });
    await prisma?.idempotencyRecord.deleteMany({ where: { scope: { contains: 'REVIEW_POLICY' } } });
    await prisma?.$disconnect();
  });

  it('reads and updates channel policy with strong version and idempotency semantics', async () => {
    const initial = await app.inject({ method: 'GET', url: `/v1/channel-profiles/${channelId}/review-policy` });
    expect(initial.statusCode).toBe(200);
    expect(initial.headers.etag).toBe('"1"');
    expect(initial.json().data).toMatchObject({
      ownerType: 'CHANNEL', version: 1, parentPolicyVersion: null,
      stored: { castGate: 'NOT_REQUIRED', scriptGate: 'MANUAL_REQUIRED', autoRequestRender: false },
      effective: { scriptGate: 'MANUAL_REQUIRED' },
      inheritance: { scriptGate: 'CHANNEL' },
    });

    const key = '01994429-ec00-7000-8000-000000000091';
    const update = await app.inject({
      method: 'PATCH', url: `/v1/channel-profiles/${channelId}/review-policy`,
      headers: { 'if-match': '"1"', 'idempotency-key': key }, payload: { scriptGate: 'NOT_REQUIRED' },
    });
    expect(update.statusCode).toBe(200);
    expect(update.headers.etag).toBe('"2"');
    expect(update.json().data).toMatchObject({ version: 2, effective: { scriptGate: 'NOT_REQUIRED' } });

    const replay = await app.inject({
      method: 'PATCH', url: `/v1/channel-profiles/${channelId}/review-policy`,
      headers: { 'if-match': '"1"', 'idempotency-key': key }, payload: { scriptGate: 'NOT_REQUIRED' },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.version).toBe(2);

    const reused = await app.inject({
      method: 'PATCH', url: `/v1/channel-profiles/${channelId}/review-policy`,
      headers: { 'if-match': '"2"', 'idempotency-key': key }, payload: { ttsGate: 'NOT_REQUIRED' },
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('resolves field inheritance, supports null reset and includes parent policy in concurrency', async () => {
    const inherited = await app.inject({ method: 'GET', url: `/v1/series-profiles/${seriesId}/review-policy` });
    expect(inherited.statusCode).toBe(200);
    expect(inherited.headers.etag).toBe('"1:2"');
    expect(inherited.json().data).toMatchObject({
      stored: { scriptGate: null }, effective: { scriptGate: 'NOT_REQUIRED' },
      inheritance: { scriptGate: 'CHANNEL' },
    });

    const override = await app.inject({
      method: 'PATCH', url: `/v1/series-profiles/${seriesId}/review-policy`,
      headers: { 'if-match': '"1:2"', 'idempotency-key': '01994429-ec00-7000-8000-000000000092' },
      payload: { scriptGate: 'MANUAL_REQUIRED' },
    });
    expect(override.statusCode).toBe(200);
    expect(override.headers.etag).toBe('"2:2"');
    expect(override.json().data).toMatchObject({ inheritance: { scriptGate: 'SERIES' } });

    const reset = await app.inject({
      method: 'PATCH', url: `/v1/series-profiles/${seriesId}/review-policy`,
      headers: { 'if-match': '"2:2"', 'idempotency-key': '01994429-ec00-7000-8000-000000000093' },
      payload: { scriptGate: null },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.headers.etag).toBe('"3:2"');
    expect(reset.json().data).toMatchObject({ stored: { scriptGate: null }, inheritance: { scriptGate: 'CHANNEL' } });
  });

  it('keeps existing job snapshot immutable while new snapshots use the updated policy', async () => {
    const profiles = new ProfilesService(new PrismaProfileRepository(prisma));
    const captured = await profiles.snapshotForJob(channelId, seriesId);
    await prisma.pipelineJob.create({ data: {
      id: jobId, videoId, kind: 'RERENDER', status: 'QUEUED', pipelineVersion: 'review-policy-test-v1',
      profileSnapshot: captured as unknown as Prisma.InputJsonValue, requestedOutputs: {}, createdById: userId,
    } });
    expect(captured.reviewPolicy).toMatchObject({ channelPolicyVersion: 2, seriesPolicyVersion: 3 });

    const updateParent = await app.inject({
      method: 'PATCH', url: `/v1/channel-profiles/${channelId}/review-policy`,
      headers: { 'if-match': '"2"', 'idempotency-key': '01994429-ec00-7000-8000-000000000094' },
      payload: { ttsGate: 'NOT_REQUIRED' },
    });
    expect(updateParent.statusCode).toBe(200);
    expect(updateParent.headers.etag).toBe('"3"');

    const staleSeries = await app.inject({
      method: 'PATCH', url: `/v1/series-profiles/${seriesId}/review-policy`,
      headers: { 'if-match': '"3:2"', 'idempotency-key': '01994429-ec00-7000-8000-000000000095' },
      payload: { autoRequestRender: true },
    });
    expect(staleSeries.statusCode).toBe(412);
    expect(staleSeries.json()).toMatchObject({ code: 'VERSION_CONFLICT' });

    const persisted = await prisma.pipelineJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(persisted.profileSnapshot).toMatchObject({
      reviewPolicy: { channelPolicyVersion: 2, seriesPolicyVersion: 3, effective: { ttsGate: 'MANUAL_REQUIRED' } },
    });
    const current = await profiles.snapshotForJob(channelId, seriesId);
    expect(current.reviewPolicy).toMatchObject({
      channelPolicyVersion: 3, seriesPolicyVersion: 3, effective: { ttsGate: 'NOT_REQUIRED' },
    });
  });
});
