import { PrismaClient } from '@prisma/client';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApplication } from '../../src/application';
import type { AppConfig } from '../../src/platform/config/config';
import { uuidV7 } from '../../src/platform/ids/uuid-v7';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const ownerId = '01994429-ec00-7000-8000-000000000002';

describeWithDatabase('Manual Publishing API with PostgreSQL', () => {
  let app: NestFastifyApplication; let prisma: PrismaClient;
  const ids = { channel: uuidV7(), source: uuidV7(), video: uuidV7(), otherSource: uuidV7(), otherVideo: uuidV7(), videoAsset: uuidV7(), subtitleAsset: uuidV7(), videoLink: uuidV7(), subtitleLink: uuidV7(), output: uuidV7(), otherOutput: uuidV7(), youtube: uuidV7(), facebook: uuidV7() };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    await prisma.channelProfile.create({ data: { id: ids.channel, name: 'Publishing channel', normalizedName: `publishing-${ids.channel}`, status: 'ACTIVE', targetLanguage: 'vi', subtitleLanguage: 'vi', subtitleFilenameRule: '{slug}.vi.srt', reviewPolicy: { create: { id: uuidV7(), castGate: 'NOT_REQUIRED', scriptGate: 'NOT_REQUIRED', ttsGate: 'NOT_REQUIRED', renderGate: 'NOT_REQUIRED', publishContentGate: 'MANUAL_REQUIRED', autoRequestRender: false } } } });
    await prisma.publishingDestination.createMany({ data: [
      { id: ids.youtube, channelProfileId: ids.channel, platform: 'YOUTUBE', displayName: 'YouTube chính', normalizedName: `youtube-${ids.youtube}`, isRequired: true },
      { id: ids.facebook, channelProfileId: ids.channel, platform: 'FACEBOOK', displayName: 'Facebook chính', normalizedName: `facebook-${ids.facebook}`, isRequired: true },
    ] });
    const observedAt = new Date();
    await prisma.sourceContent.createMany({ data: [
      { id: ids.source, platform: 'DOUYIN', externalId: `publish-${ids.source}`, contentType: 'VIDEO', availability: 'AVAILABLE', firstSeenAt: observedAt, lastSeenAt: observedAt },
      { id: ids.otherSource, platform: 'DOUYIN', externalId: `publish-${ids.otherSource}`, contentType: 'VIDEO', availability: 'AVAILABLE', firstSeenAt: observedAt, lastSeenAt: observedAt },
    ] });
    await prisma.video.createMany({ data: [
      { id: ids.video, sourceContentId: ids.source, channelProfileId: ids.channel, status: 'READY_TO_PUBLISH', sourceLanguage: 'zh', targetLanguage: 'vi', createdById: ownerId },
      { id: ids.otherVideo, sourceContentId: ids.otherSource, channelProfileId: ids.channel, status: 'READY_TO_PUBLISH', sourceLanguage: 'zh', targetLanguage: 'vi', createdById: ownerId },
    ] });
    await prisma.asset.createMany({ data: [
      { id: ids.videoAsset, storageBackend: 'R2', bucket: 'publishing-test', objectKey: `outputs/${ids.video}.mp4`, fileName: 'output.mp4', status: 'AVAILABLE', contentType: 'video/mp4' },
      { id: ids.subtitleAsset, storageBackend: 'R2', bucket: 'publishing-test', objectKey: `outputs/${ids.video}.srt`, fileName: 'output.vi.srt', status: 'AVAILABLE', contentType: 'text/plain' },
    ] });
    await prisma.videoAsset.createMany({ data: [
      { id: ids.videoLink, videoId: ids.video, assetId: ids.videoAsset, kind: 'OUTPUT_VIDEO' },
      { id: ids.subtitleLink, videoId: ids.video, assetId: ids.subtitleAsset, kind: 'OUTPUT_SUBTITLE' },
    ] });
    await prisma.renderOutput.create({ data: { id: ids.output, videoId: ids.video, variant: 'FULL_16X9', status: 'APPROVED', videoAssetId: ids.videoLink, subtitleAssetId: ids.subtitleLink, approvedBy: ownerId, approvedAt: new Date() } });
    await prisma.renderOutput.create({ data: { id: ids.otherOutput, videoId: ids.otherVideo, variant: 'FULL_16X9', status: 'APPROVED', approvedBy: ownerId, approvedAt: new Date() } });
    const config: AppConfig = { nodeEnv: 'test', port: 3000, logLevel: 'fatal', corsOrigins: ['http://localhost:5173'], rateLimitMax: 1000, rateLimitWindowMs: 60_000, healthRateLimitMax: 100, trustProxy: false, databaseUrl: databaseUrl!, settingsEncryptionKey: Buffer.alloc(32, 7).toString('base64') };
    app = await createApplication(config);
  });

  afterAll(async () => {
    await app?.close();
    const packages = await prisma.publishPackage.findMany({ where: { videoId: { in: [ids.video, ids.otherVideo] } }, select: { id: true } }); const packageIds = packages.map((x) => x.id);
    const tasks = await prisma.publicationTask.findMany({ where: { publishPackageId: { in: packageIds } }, select: { id: true } }); const taskIds = tasks.map((x) => x.id);
    const fields = await prisma.publicationField.findMany({ where: { publicationTaskId: { in: taskIds } }, select: { id: true } }); const fieldIds = fields.map((x) => x.id);
    await prisma.publicationField.updateMany({ where: { id: { in: fieldIds } }, data: { currentRevisionId: null } });
    await prisma.publicationProof.deleteMany({ where: { publicationTaskId: { in: taskIds } } }); await prisma.publicationChecklistItem.deleteMany({ where: { publicationTaskId: { in: taskIds } } }); await prisma.publicationFieldRevision.deleteMany({ where: { publicationFieldId: { in: fieldIds } } }); await prisma.publicationField.deleteMany({ where: { id: { in: fieldIds } } }); await prisma.publicationTask.deleteMany({ where: { id: { in: taskIds } } }); await prisma.publishPackage.deleteMany({ where: { id: { in: packageIds } } });
    await prisma.reviewDecision.deleteMany({ where: { videoId: { in: [ids.video, ids.otherVideo] } } }); await prisma.renderOutput.deleteMany({ where: { id: { in: [ids.output, ids.otherOutput] } } }); await prisma.videoAsset.deleteMany({ where: { id: { in: [ids.videoLink, ids.subtitleLink] } } }); await prisma.asset.deleteMany({ where: { id: { in: [ids.videoAsset, ids.subtitleAsset] } } }); await prisma.video.deleteMany({ where: { id: { in: [ids.video, ids.otherVideo] } } }); await prisma.sourceContent.deleteMany({ where: { id: { in: [ids.source, ids.otherSource] } } }); await prisma.publishingDestination.deleteMany({ where: { id: { in: [ids.youtube, ids.facebook] } } }); await prisma.reviewPolicy.deleteMany({ where: { channelProfileId: ids.channel } }); await prisma.channelProfile.deleteMany({ where: { id: ids.channel } }); await prisma.idempotencyRecord.deleteMany({ where: { scope: { contains: 'PUBLICATION' } } }); await prisma.$disconnect();
  });

  it('creates package idempotently and rejects output from another Video', async () => {
    const key = uuidV7(); const payload = { tasks: [{ destinationId: ids.youtube, renderOutputId: ids.output }, { destinationId: ids.facebook, renderOutputId: ids.output }] };
    const created = await app.inject({ method: 'POST', url: `/v1/videos/${ids.video}/publish-packages`, headers: { 'idempotency-key': key }, payload });
    expect(created.statusCode).toBe(201); expect(created.headers.etag).toBe('"1"'); expect(created.json().data.tasks).toHaveLength(2);
    const replay = await app.inject({ method: 'POST', url: `/v1/videos/${ids.video}/publish-packages`, headers: { 'idempotency-key': key }, payload });
    expect(replay.statusCode).toBe(201); expect(replay.json().data.id).toBe(created.json().data.id);
    const wrong = await app.inject({ method: 'POST', url: `/v1/videos/${ids.otherVideo}/publish-packages`, headers: { 'idempotency-key': uuidV7() }, payload: { tasks: [{ destinationId: ids.youtube, renderOutputId: ids.output }] } });
    expect(wrong.statusCode).toBe(422); expect(wrong.json()).toMatchObject({ code: 'PUBLICATION_ASSET_UNAVAILABLE' });
  });

  it('retains field revisions, enforces lock/policy/checklist and completes required siblings independently', async () => {
    const packageRow = await prisma.publishPackage.findFirstOrThrow({ where: { videoId: ids.video }, include: { tasks: { include: { fields: true, checklist: true } } } });
    for (const task of packageRow.tasks) {
      let version = task.version;
      for (const field of task.fields) { const response = await app.inject({ method: 'PATCH', url: `/v1/publication-tasks/${task.id}/fields/${field.fieldKey}`, headers: { 'if-match': `"${version}"` }, payload: { value: `${field.fieldKey} value` } }); expect(response.statusCode).toBe(200); version = response.json().data.version; }
      const field = task.fields[0]!;
      const edited = await app.inject({ method: 'PATCH', url: `/v1/publication-tasks/${task.id}/fields/${field.fieldKey}`, headers: { 'if-match': `"${version}"` }, payload: { value: `${field.fieldKey} revised` } }); version = edited.json().data.version;
      const locked = await app.inject({ method: 'PATCH', url: `/v1/publication-tasks/${task.id}/fields/${field.fieldKey}/lock`, headers: { 'if-match': `"${version}"` }, payload: { isLocked: true } }); version = locked.json().data.version;
      const rejected = await app.inject({ method: 'PATCH', url: `/v1/publication-tasks/${task.id}/fields/${field.fieldKey}`, headers: { 'if-match': `"${version}"` }, payload: { value: 'blocked' } }); expect(rejected.statusCode).toBe(422); expect(rejected.json()).toMatchObject({ code: 'PUBLICATION_FIELD_LOCKED' });
      const approved = await app.inject({ method: 'POST', url: `/v1/publication-tasks/${task.id}/approve-content`, headers: { 'if-match': `"${version}"`, 'idempotency-key': uuidV7() } }); expect(approved.statusCode).toBe(200); expect(approved.json().data.status).toBe('READY_TO_PUBLISH'); version = approved.json().data.version;
      const unlocked = await app.inject({ method: 'PATCH', url: `/v1/publication-tasks/${task.id}/fields/${field.fieldKey}/lock`, headers: { 'if-match': `"${version}"` }, payload: { isLocked: false } }); version = unlocked.json().data.version;
      const staleApproval = await app.inject({ method: 'PATCH', url: `/v1/publication-tasks/${task.id}/fields/${field.fieldKey}`, headers: { 'if-match': `"${version}"` }, payload: { value: `${field.fieldKey} final` } }); expect(staleApproval.json().data.status).toBe('CONTENT_GENERATED'); version = staleApproval.json().data.version;
      const reapproved = await app.inject({ method: 'POST', url: `/v1/publication-tasks/${task.id}/approve-content`, headers: { 'if-match': `"${version}"`, 'idempotency-key': uuidV7() } }); expect(reapproved.json().data.status).toBe('READY_TO_PUBLISH'); version = reapproved.json().data.version;
      for (const item of task.checklist.filter((x) => x.isRequired)) { const done = await app.inject({ method: 'PATCH', url: `/v1/publication-tasks/${task.id}/checklist/${item.itemKey}`, headers: { 'if-match': `"${version}"` }, payload: { status: 'COMPLETED' } }); version = done.json().data.version; }
      const started = await app.inject({ method: 'POST', url: `/v1/publication-tasks/${task.id}/start-manual-posting`, headers: { 'if-match': `"${version}"`, 'idempotency-key': uuidV7() } }); expect(started.statusCode).toBe(200); version = started.json().data.version;
      const proof = await app.inject({ method: 'POST', url: `/v1/publication-tasks/${task.id}/proofs`, headers: { 'if-match': `"${version}"`, 'idempotency-key': uuidV7() }, payload: { publicUrl: `https://example.test/posts/${task.id}` } }); expect(proof.statusCode).toBe(201); expect(proof.json().data.proofs).toHaveLength(1); version = proof.json().data.version;
      const retryProof = await app.inject({ method: 'POST', url: `/v1/publication-tasks/${task.id}/proofs`, headers: { 'if-match': `"${version}"`, 'idempotency-key': uuidV7() }, payload: { platformPostId: `post-${task.id}` } }); expect(retryProof.json().data.proofs).toHaveLength(2); version = retryProof.json().data.version;
      const proofId = retryProof.json().data.proofs[0].id; const verified = await app.inject({ method: 'POST', url: `/v1/publication-tasks/${task.id}/proofs/${proofId}/verify`, headers: { 'if-match': `"${version}"`, 'idempotency-key': uuidV7() }, payload: { status: 'VERIFIED' } }); expect(verified.statusCode).toBe(200);
      const currentVideo = await prisma.video.findUniqueOrThrow({ where: { id: ids.video } }); if (task.id !== packageRow.tasks.at(-1)!.id) expect(currentVideo.status).toBe('READY_TO_PUBLISH');
    }
    const currentVideo = await prisma.video.findUniqueOrThrow({ where: { id: ids.video } }); expect(currentVideo.status).toBe('PUBLISHED');
    const revisions = await prisma.publicationFieldRevision.findMany({ where: { publicationFieldId: packageRow.tasks[0]!.fields[0]!.id }, orderBy: { revision: 'asc' } }); expect(revisions).toHaveLength(3); expect(revisions.map((x) => x.valueText)).toEqual(expect.arrayContaining([expect.stringContaining('value'), expect.stringContaining('revised'), expect.stringContaining('final')]));
    expect(await prisma.reviewDecision.count({ where: { videoId: ids.video, scope: 'PUBLISH_CONTENT', decision: 'APPROVED' } })).toBe(4);
  });
});
