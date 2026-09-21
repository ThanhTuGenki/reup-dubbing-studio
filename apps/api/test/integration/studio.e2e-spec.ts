import { PrismaClient } from '@prisma/client';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApplication } from '../../src/application';
import type { AppConfig } from '../../src/platform/config/config';
import { uuidV7 } from '../../src/platform/ids/uuid-v7';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
describeWithDatabase('Studio API with PostgreSQL', () => {
  let app: NestFastifyApplication; let prisma: PrismaClient; let videoId: string; let segmentId: string; let voiceId: string;
  let userId: string; let sourceId: string; let channelId: string; let voiceAssetId: string;
  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    userId = uuidV7(); sourceId = uuidV7(); channelId = uuidV7(); voiceId = uuidV7(); videoId = uuidV7(); segmentId = uuidV7(); const revisionId = uuidV7();
    await prisma.user.create({ data: { id: userId, displayName: 'Studio test' } });
    voiceAssetId = uuidV7();
    const asset = await prisma.asset.create({ data: { id: voiceAssetId, storageBackend: 'R2', bucket: 'studio', objectKey: `voice/${voiceId}`, fileName: 'voice.wav', status: 'AVAILABLE' } });
    await prisma.voiceProfile.create({ data: { id: voiceId, name: `Studio voice ${voiceId}`, normalizedName: `studio voice ${voiceId}`, primaryLanguage: 'vi', status: 'READY', licenseKind: 'OWNED_RECORDING', commercialUseAllowed: true, samples: { create: { id: uuidV7(), assetId: asset.id, language: 'vi', transcript: 'xin chào', durationMs: 3000, revision: 1 } } } });
    await prisma.channelProfile.create({ data: { id: channelId, name: 'Studio channel', normalizedName: `studio-${channelId}`, status: 'ACTIVE', targetLanguage: 'vi', defaultVoiceProfileId: voiceId, subtitleLanguage: 'vi', subtitleFilenameRule: '{slug}.srt' } });
    const now = new Date(); await prisma.sourceContent.create({ data: { id: sourceId, platform: 'DOUYIN', externalId: `studio-${sourceId}`, contentType: 'VIDEO', title: 'Studio video', durationMs: 3000, availability: 'AVAILABLE', firstSeenAt: now, lastSeenAt: now } });
    await prisma.video.create({ data: { id: videoId, sourceContentId: sourceId, channelProfileId: channelId, status: 'AWAITING_REVIEW', sourceLanguage: 'zh', targetLanguage: 'vi', displayTitle: 'Studio video', createdById: userId, segments: { create: { id: segmentId, ordinal: 1, sourceStartMs: 0, sourceEndMs: 2000 } } } });
    await prisma.segmentRevision.create({ data: { id: revisionId, videoSegmentId: segmentId, revision: 1, sourceText: '你好', translatedText: 'Xin chào', voiceProfileId: voiceId, targetStartMs: 0, targetEndMs: 2000, createdBy: userId } });
    await prisma.videoSegment.update({ where: { id: segmentId }, data: { currentRevisionId: revisionId } });
    const config: AppConfig = { nodeEnv: 'test', port: 3000, logLevel: 'fatal', corsOrigins: ['http://localhost:5173'], rateLimitMax: 100, rateLimitWindowMs: 60_000, healthRateLimitMax: 100, trustProxy: false, databaseUrl: databaseUrl!, settingsEncryptionKey: Buffer.alloc(32, 8).toString('base64') };
    app = await createApplication(config);
  });
  afterAll(async () => {
    await app?.close();
    const jobs = await prisma?.pipelineJob.findMany({ where: { videoId }, select: { id: true } });
    const jobIds = jobs?.map(({ id }) => id) ?? [];
    await prisma?.pipelineTask.deleteMany({ where: { pipelineJobId: { in: jobIds } } });
    await prisma?.pipelineJob.deleteMany({ where: { id: { in: jobIds } } });
    await prisma?.videoSegment.update({ where: { id: segmentId }, data: { currentRevisionId: null } });
    await prisma?.segmentAudioRevision.deleteMany({ where: { videoSegmentId: segmentId } });
    await prisma?.segmentRevision.deleteMany({ where: { videoSegmentId: segmentId } });
    await prisma?.videoSegment.delete({ where: { id: segmentId } });
    await prisma?.video.delete({ where: { id: videoId } });
    await prisma?.sourceContent.delete({ where: { id: sourceId } });
    await prisma?.channelProfile.delete({ where: { id: channelId } });
    await prisma?.voiceProfileSample.deleteMany({ where: { voiceProfileId: voiceId } });
    await prisma?.voiceProfile.delete({ where: { id: voiceId } });
    await prisma?.asset.delete({ where: { id: voiceAssetId } });
    await prisma?.user.delete({ where: { id: userId } });
    await prisma?.$disconnect();
  });
  it('reads Studio and creates immutable revisions with ETag concurrency', async () => {
    const detail = await app.inject({ method: 'GET', url: `/v1/videos/${videoId}/studio` }); expect(detail.statusCode).toBe(200); expect(detail.headers.etag).toBe('"1"'); expect(detail.json().data.segments[0].revision.translatedText).toBe('Xin chào'); expect(JSON.stringify(detail.json())).not.toMatch(/objectKey|bucket/iu);
    const edited = await app.inject({ method: 'PATCH', url: `/v1/videos/${videoId}/segments/${segmentId}`, headers: { 'if-match': '"1"' }, payload: { translatedText: 'Chào bạn', voiceProfileId: voiceId, editReason: 'Sửa bản dịch' } }); expect(edited.statusCode).toBe(200); expect(edited.json().data).toMatchObject({ revision: 2, version: 2 }); expect(await prisma.segmentRevision.count({ where: { videoSegmentId: segmentId } })).toBe(2);
    const stale = await app.inject({ method: 'PATCH', url: `/v1/videos/${videoId}/segments/${segmentId}`, headers: { 'if-match': '"1"' }, payload: { translatedText: 'stale' } }); expect(stale.statusCode).toBe(412); expect(stale.json().code).toBe('VERSION_CONFLICT');
  });
  it('queues regenerate idempotently without running a Worker', async () => {
    const response = await app.inject({ method: 'POST', url: `/v1/videos/${videoId}/segments/${segmentId}/regenerate`, headers: { 'if-match': '"2"', 'idempotency-key': 'studio-regen-test-0001' } }); expect(response.statusCode).toBe(202); const body = response.json().data;
    const replay = await app.inject({ method: 'POST', url: `/v1/videos/${videoId}/segments/${segmentId}/regenerate`, headers: { 'if-match': '"2"', 'idempotency-key': 'studio-regen-test-0001' } }); expect(replay.json().data.jobId).toBe(body.jobId);
    const task = await prisma.pipelineTask.findUniqueOrThrow({ where: { id: body.taskId } }); expect(task).toMatchObject({ taskType: 'REGENERATE_SEGMENT', resourceClass: 'GPU_TTS_INTERACTIVE', status: 'READY' }); expect(await prisma.taskAttempt.count({ where: { pipelineTaskId: task.id } })).toBe(0);
  });
  it('rejects preview when no available selected audio exists', async () => { const response = await app.inject({ method: 'POST', url: `/v1/videos/${videoId}/segments/${segmentId}/preview` }); expect(response.statusCode).toBe(409); expect(response.json().code).toBe('PREVIEW_NOT_AVAILABLE'); });
});
