import { PrismaClient } from '@prisma/client';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApplication } from '../../src/application';
import type { ProfileObjectStore } from '../../src/modules/profiles/application/asset-ports';
import { ProfileAssetsService } from '../../src/modules/profiles/application/profile-assets.service';
import { ProfilesService } from '../../src/modules/profiles/application/profiles.service';
import { PrismaProfileAssetRepository } from '../../src/modules/profiles/infrastructure/prisma-profile-asset-repository';
import { PrismaProfileRepository } from '../../src/modules/profiles/infrastructure/prisma-profile-repository';
import type { AppConfig } from '../../src/platform/config/config';
import { uuidV7 } from '../../src/platform/ids/uuid-v7';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('Channel and Series Profile API with PostgreSQL', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  let voiceId: string;
  let voiceSampleId: string;
  let voiceAssetId: string;
  let channelId: string;
  let seriesId: string;

  beforeAll(async () => {
    const config: AppConfig = {
      nodeEnv: 'test', port: 3000, logLevel: 'error', corsOrigins: ['http://localhost:5173'],
      rateLimitMax: 100, rateLimitWindowMs: 60_000, healthRateLimitMax: 100,
      trustProxy: false, databaseUrl: databaseUrl!,
      settingsEncryptionKey: Buffer.alloc(32, 4).toString('base64'),
    };
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    await prisma.systemSetting.update({ where: { singletonKey: 'DEFAULT' }, data: {
      version: 1, rawVideoDays: 7, intermediateDays: 3, taskLogDays: 30, finalOutputDays: 90,
    } });
    await prisma.idempotencyRecord.deleteMany({ where: { scope: { contains: 'PROFILE' } } });
    await prisma.channelProfileAsset.deleteMany();
    await prisma.seriesProfileAsset.deleteMany();
    await prisma.voiceProfileSample.deleteMany();
    await prisma.asset.deleteMany();
    await prisma.publishingDestination.deleteMany();
    await prisma.reviewPolicy.deleteMany();
    await prisma.seriesProfile.deleteMany();
    await prisma.channelProfile.deleteMany();
    await prisma.voiceProfile.deleteMany();
    voiceId = uuidV7();
    await prisma.voiceProfile.create({ data: {
      id: voiceId, name: 'Vietnamese narrator', normalizedName: 'vietnamese narrator',
      primaryLanguage: 'vi', status: 'READY', licenseKind: 'OWNED_RECORDING', commercialUseAllowed: true,
    } });
    voiceAssetId = uuidV7();
    voiceSampleId = uuidV7();
    await prisma.asset.create({ data: {
      id: voiceAssetId, storageBackend: 'R2', bucket: 'profile-test', objectKey: `voices/${voiceId}/sample-v1.wav`,
      fileName: 'sample-v1.wav', status: 'AVAILABLE', checksumSha256: 'a'.repeat(64), byteSize: 128,
      contentType: 'audio/wav', uploadedAt: new Date(), verifiedAt: new Date(),
    } });
    await prisma.voiceProfileSample.create({ data: {
      id: voiceSampleId, voiceProfileId: voiceId, assetId: voiceAssetId, language: 'vi',
      transcript: 'Xin chào', durationMs: 5000, revision: 1,
    } });
    app = await createApplication(config);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('creates, resolves inheritance and detects parent-version conflicts', async () => {
    const channelPayload = {
      name: 'Main channel',
      pipeline: {
        targetLanguage: 'vi', defaultVoiceProfileId: voiceId, voiceMode: 'SINGLE',
        subtitleLanguage: 'vi', subtitleFilenameRule: '{slug}.vi.srt', subtitleMaxLineLength: 42,
        ttsSpeed: 1, timingPolicy: 'FIT_SEGMENT', output16x9Enabled: true, output9x16Enabled: false,
      },
      content: { voiceRules: { tone: 'warm' }, ctaTemplate: null, metadataTemplate: {}, baseKeywords: ['phim'] },
      destinations: [{ platform: 'YOUTUBE', externalId: 'UC-test', displayName: 'Main', isRequired: true, isActive: true, platformConfig: {} }],
    };
    const createChannel = await app.inject({
      method: 'POST', url: '/v1/channel-profiles',
      headers: { 'idempotency-key': '01994429-ec00-7000-8000-000000000020' },
      payload: channelPayload,
    });
    expect(createChannel.statusCode).toBe(201);
    expect(createChannel.headers.etag).toBe('"1"');
    expect(createChannel.json().data).toMatchObject({ status: 'DRAFT', readiness: 'READY' });
    channelId = createChannel.json().data.id as string;

    const replay = await app.inject({
      method: 'POST', url: '/v1/channel-profiles',
      headers: { 'idempotency-key': '01994429-ec00-7000-8000-000000000020' },
      payload: channelPayload,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().data.id).toBe(channelId);
    expect(await prisma.idempotencyRecord.count({ where: { scope: 'CREATE_CHANNEL_PROFILE' } })).toBe(1);

    const activate = await app.inject({
      method: 'PATCH', url: `/v1/channel-profiles/${channelId}`,
      headers: { 'if-match': '"1"' }, payload: { status: 'ACTIVE' },
    });
    expect(activate.statusCode).toBe(200);
    expect(activate.headers.etag).toBe('"2"');

    const createSeries = await app.inject({
      method: 'POST', url: '/v1/series-profiles',
      headers: { 'idempotency-key': '01994429-ec00-7000-8000-000000000021' },
      payload: {
        channelProfileId: channelId, name: 'Drama',
        overrides: { ttsSpeed: 1.1, output9x16Enabled: true },
        mask: { x: 0.1, y: 0.8, width: 0.8, height: 0.1 },
      },
    });
    expect(createSeries.statusCode).toBe(201);
    expect(createSeries.headers.etag).toBe('"1:2"');
    expect(createSeries.json().data).toMatchObject({
      effectiveConfig: { targetLanguage: 'vi', ttsSpeed: 1.1, output9x16Enabled: true },
      inheritance: { targetLanguage: 'CHANNEL', ttsSpeed: 'SERIES' },
      readinessIssues: ['MASK_REFERENCE_ASSET_REQUIRED'],
    });
    seriesId = createSeries.json().data.id as string;

    const updateParent = await app.inject({
      method: 'PATCH', url: `/v1/channel-profiles/${channelId}`,
      headers: { 'if-match': '"2"' }, payload: { pipeline: { subtitleMaxLineLength: 50 } },
    });
    expect(updateParent.statusCode).toBe(200);
    expect(updateParent.headers.etag).toBe('"3"');

    const staleSeries = await app.inject({
      method: 'PATCH', url: `/v1/series-profiles/${seriesId}`,
      headers: { 'if-match': '"1:2"' }, payload: { name: 'Drama updated' },
    });
    expect(staleSeries.statusCode).toBe(409);
    expect(staleSeries.json()).toMatchObject({ code: 'PROFILE_VERSION_CONFLICT' });

    const archiveParent = await app.inject({
      method: 'POST', url: `/v1/channel-profiles/${channelId}/archive`, headers: { 'if-match': '"3"' },
    });
    expect(archiveParent.statusCode).toBe(409);
    expect(archiveParent.json()).toMatchObject({ code: 'PROFILE_HAS_ACTIVE_SERIES' });
  });

  it('commits and detaches a verified mask reference asset idempotently', async () => {
    const repository = new PrismaProfileAssetRepository(prisma);
    const store: ProfileObjectStore = {
      target: async () => ({ bucket: 'profile-test' }),
      createUploadGrant: async () => ({
        url: 'https://example.invalid/upload?signature=secret',
        headers: { 'Content-Type': 'image/webp' }, expiresAt: new Date('2026-09-20T12:10:00.000Z'),
      }),
      createPreviewGrant: async () => ({
        url: 'https://example.invalid/preview?signature=secret', expiresAt: new Date('2026-09-20T12:05:00.000Z'),
      }),
      inspect: async () => ({ byteSize: 128, contentType: 'image/webp' }),
    };
    const service = new ProfileAssetsService(repository, store);
    const owner = { type: 'SERIES' as const, id: seriesId };
    const grant = await service.requestUpload(owner, {
      role: 'MASK_REFERENCE_FRAME', fileName: 'mask-frame.webp', contentType: 'image/webp',
      byteSize: 128, width: 1920, height: 1080,
    });
    const key = '01994429-ec00-7000-8000-000000000023';
    const committed = await service.commit(owner, grant.assetId, 1, 3, key);
    expect(committed).toMatchObject({ profileVersion: 2, parentVersion: 3, asset: { role: 'MASK_REFERENCE_FRAME', revision: 1 } });
    await expect(service.commit(owner, grant.assetId, 1, 3, key)).resolves.toEqual(committed);
    expect(await prisma.seriesProfileAsset.count({ where: { seriesProfileId: seriesId } })).toBe(1);

    await expect(service.preview(owner, committed.asset.linkId)).resolves.toMatchObject({
      assetId: committed.asset.assetId, method: 'GET', fileName: 'mask-frame.webp', byteSize: 128,
    });

    const ready = await app.inject({ method: 'GET', url: `/v1/series-profiles/${seriesId}` });
    expect(ready.headers.etag).toBe('"2:3"');
    expect(ready.json().data).toMatchObject({ readiness: 'READY', readinessIssues: [] });

    const detached = await app.inject({
      method: 'DELETE', url: `/v1/series-profiles/${seriesId}/assets/${committed.asset.linkId}`,
      headers: { 'if-match': '"2:3"' },
    });
    expect(detached.statusCode).toBe(200);
    expect(detached.headers.etag).toBe('"3:3"');
    const afterDetach = await app.inject({ method: 'GET', url: `/v1/series-profiles/${seriesId}` });
    expect(afterDetach.json().data.readinessIssues).toContain('MASK_REFERENCE_ASSET_REQUIRED');
  });

  it('rejects a mask rectangle that exceeds normalized bounds', async () => {
    const channel = await prisma.channelProfile.findFirstOrThrow();
    const response = await app.inject({
      method: 'POST', url: '/v1/series-profiles',
      headers: { 'idempotency-key': '01994429-ec00-7000-8000-000000000022' },
      payload: { channelProfileId: channel.id, name: 'Invalid mask', mask: { x: 0.8, y: 0.8, width: 0.3, height: 0.3 } },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'PROFILE_MASK_INVALID' });
  });

  it('rejects null for non-nullable pipeline fields without reaching Prisma', async () => {
    const response = await app.inject({
      method: 'PATCH', url: `/v1/channel-profiles/${channelId}`,
      headers: { 'if-match': '"3"' }, payload: { pipeline: { output16x9Enabled: null } },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'PROFILE_VALIDATION_FAILED' });
  });

  it('resolves an immutable job snapshot from active inherited configuration', async () => {
    const create = await app.inject({
      method: 'POST', url: '/v1/series-profiles',
      headers: { 'idempotency-key': '01994429-ec00-7000-8000-000000000024' },
      payload: { channelProfileId: channelId, name: 'Snapshot series', overrides: { ttsSpeed: 1.2 } },
    });
    expect(create.statusCode).toBe(201);
    const snapshotSeriesId = create.json().data.id as string;
    const activate = await app.inject({
      method: 'PATCH', url: `/v1/series-profiles/${snapshotSeriesId}`,
      headers: { 'if-match': '"1:3"' }, payload: { status: 'ACTIVE' },
    });
    expect(activate.statusCode).toBe(200);

    const service = new ProfilesService(new PrismaProfileRepository(prisma));
    const captured = await service.snapshotForJob(channelId, snapshotSeriesId);
    const persisted = JSON.parse(JSON.stringify(captured)) as typeof captured;
    expect(captured).toMatchObject({
      schemaVersion: 2,
      profile: { channelProfileId: channelId, channelProfileVersion: 3, seriesProfileId: snapshotSeriesId, seriesProfileVersion: 2 },
      pipeline: { targetLanguage: 'vi', subtitleMaxLineLength: 50, ttsSpeed: 1.2 },
      defaultVoice: {
        profileId: voiceId, version: 1, sampleLinkId: voiceSampleId, sampleAssetId: voiceAssetId,
        sampleRevision: 1, sampleLanguage: 'vi', requestedLanguage: 'vi', usedCrossLingualFallback: false,
        assetVersion: 1, objectKey: `voices/${voiceId}/sample-v1.wav`, checksumSha256: 'a'.repeat(64),
      },
      retention: { settingsVersion: 1, rawVideoDays: 7 },
      reviewPolicy: {
        schemaVersion: 1, channelPolicyVersion: 1, seriesPolicyVersion: 1,
        effective: { castGate: 'NOT_REQUIRED', scriptGate: 'MANUAL_REQUIRED', autoRequestRender: false },
      },
    });

    await prisma.channelProfile.update({ where: { id: channelId }, data: {
      subtitleLanguage: 'en', version: { increment: 1 },
    } });
    await prisma.systemSetting.update({ where: { singletonKey: 'DEFAULT' }, data: {
      rawVideoDays: 14, version: { increment: 1 },
    } });
    const replacementAssetId = uuidV7();
    const replacementSampleId = uuidV7();
    await prisma.$transaction([
      prisma.asset.create({ data: {
        id: replacementAssetId, storageBackend: 'R2', bucket: 'profile-test', objectKey: `voices/${voiceId}/sample-v2.wav`,
        fileName: 'sample-v2.wav', status: 'AVAILABLE', checksumSha256: 'b'.repeat(64), byteSize: 256,
        contentType: 'audio/wav', uploadedAt: new Date(), verifiedAt: new Date(),
      } }),
      prisma.voiceProfileSample.update({ where: { id: voiceSampleId }, data: { isCurrent: false } }),
      prisma.voiceProfileSample.create({ data: {
        id: replacementSampleId, voiceProfileId: voiceId, assetId: replacementAssetId, language: 'vi',
        transcript: 'Xin chào lần hai', durationMs: 6000, revision: 2,
      } }),
      prisma.voiceProfile.update({ where: { id: voiceId }, data: { version: { increment: 1 } } }),
    ]);
    const current = await service.snapshotForJob(channelId, snapshotSeriesId);
    expect(current).toMatchObject({
      profile: { channelProfileVersion: 4 }, pipeline: { subtitleLanguage: 'en', ttsSpeed: 1.2 },
      defaultVoice: { version: 2, sampleLinkId: replacementSampleId, sampleAssetId: replacementAssetId, sampleRevision: 2 },
      retention: { settingsVersion: 2, rawVideoDays: 14 },
    });
    expect(persisted).toMatchObject({
      profile: { channelProfileVersion: 3 }, pipeline: { subtitleLanguage: 'vi', ttsSpeed: 1.2 },
      defaultVoice: { version: 1, sampleLinkId: voiceSampleId, sampleAssetId: voiceAssetId, sampleRevision: 1 },
      retention: { settingsVersion: 1, rawVideoDays: 7 },
    });
  });

  it('refuses a job snapshot from a draft or unready profile', async () => {
    const service = new ProfilesService(new PrismaProfileRepository(prisma));
    await expect(service.snapshotForJob(channelId, seriesId)).rejects.toMatchObject({ code: 'PROFILE_NOT_READY' });
  });
});
