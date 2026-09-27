import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApplication } from '../../src/application';
import type { AppConfig } from '../../src/platform/config/config';
import { collectVideoAssetIds } from '../../src/modules/video-deletion/infrastructure/video-asset-set';
import { cleanupVideoTree, seedVideoTree, type SeededVideo } from './video-deletion-fixtures';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('Video deletion with PostgreSQL', () => {
  let prisma: PrismaClient; let app: NestFastifyApplication; const seeded: SeededVideo[] = [];
  const config: AppConfig = { nodeEnv: 'test', port: 3000, logLevel: 'fatal', corsOrigins: ['http://localhost:5173'], rateLimitMax: 100, rateLimitWindowMs: 60_000, healthRateLimitMax: 100, trustProxy: false, databaseUrl: databaseUrl!, settingsEncryptionKey: Buffer.alloc(32, 8).toString('base64') };
  beforeAll(async () => { prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } }); app = await createApplication(config); });
  afterAll(async () => { await app?.close(); for (const item of seeded) await cleanupVideoTree(prisma, item); await prisma?.$disconnect(); });
  const seed = async (options?: Parameters<typeof seedVideoTree>[1]) => { const item = await seedVideoTree(prisma, options); seeded.push(item); return item; };

  describe('collectVideoAssetIds', () => {
    it('unions links, audio, transcript and attempt outputs, including PENDING ones', async () => {
      const video = await seed({ pendingOutput: true });
      const ids = await prisma.$transaction((tx) => collectVideoAssetIds(tx, video.ids.video));
      expect(ids).toEqual([...video.videoAssetIds].sort());
    });

    it('never includes voice sample, channel or shared assets', async () => {
      const video = await seed({ sharedWithChannel: true });
      const ids = await prisma.$transaction((tx) => collectVideoAssetIds(tx, video.ids.video));
      expect(ids).not.toContain(video.asset.voiceSample);
      expect(ids).not.toContain(video.asset.channelAsset);
      expect(ids).not.toContain(video.asset.output);
      expect(ids).toContain(video.asset.raw);
    });
  });

  describe('library reads', () => {
    it('hides DELETING videos from the list but keeps DELETE_FAILED ones visible with their error', async () => {
      const deleting = await seed(); const failed = await seed();
      await prisma.video.update({ where: { id: deleting.ids.video }, data: { status: 'DELETING', deletionRequestedAt: new Date() } });
      await prisma.video.update({ where: { id: failed.ids.video }, data: { status: 'DELETE_FAILED', deletionRequestedAt: new Date(), deletionErrorCode: 'STORAGE_DELETE_FAILED' } });
      const list = await app.inject({ method: 'GET', url: '/v1/videos?limit=100&query=Video sẽ bị xóa' });
      const ids = list.json().data.items.map((item: { id: string }) => item.id);
      expect(ids).not.toContain(deleting.ids.video);
      const failedItem = list.json().data.items.find((item: { id: string }) => item.id === failed.ids.video);
      expect(failedItem.deletion).toMatchObject({ errorCode: 'STORAGE_DELETE_FAILED' });
      expect(failedItem.capabilities).toMatchObject({ canDelete: true, deleteBlockedReason: null });
      const detail = await app.inject({ method: 'GET', url: `/v1/videos/${deleting.ids.video}` });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().data.capabilities).toMatchObject({ canDelete: false, deleteBlockedReason: 'DELETING' });
    });

    it('blocks deletion of a published video and refuses grants while deleting', async () => {
      const published = await seed({ withProof: true }); const deleting = await seed();
      const detail = await app.inject({ method: 'GET', url: `/v1/videos/${published.ids.video}` });
      expect(detail.json().data.capabilities).toMatchObject({ canDelete: false, deleteBlockedReason: 'PUBLICATION_HISTORY' });
      expect(detail.json().data.deletion).toBeNull();
      await prisma.video.update({ where: { id: deleting.ids.video }, data: { status: 'DELETING', deletionRequestedAt: new Date() } });
      const grant = await app.inject({ method: 'POST', url: `/v1/videos/${deleting.ids.video}/outputs/${deleting.ids.renderOutput}/video/grant`, payload: { purpose: 'download' } });
      expect(grant.statusCode).toBe(409);
      expect(grant.json().code).toBe('VIDEO_DELETING');
    });
  });

  describe('deletion requests', () => {
    const del = (videoId: string, version: number, key = randomUUID()) => app.inject({ method: 'DELETE', url: `/v1/videos/${videoId}`, headers: { 'if-match': `"${version}"`, 'idempotency-key': key } });

    it('accepts, hides the video, marks its assets DELETING and records an audit event', async () => {
      const video = await seed();
      const response = await del(video.ids.video, 1);
      expect(response.statusCode).toBe(202);
      expect(response.json().data).toEqual({ videoId: video.ids.video, status: 'DELETING', cancelledJobIds: [] });
      const row = await prisma.video.findUniqueOrThrow({ where: { id: video.ids.video } });
      expect(row).toMatchObject({ status: 'DELETING', version: 2, deletionAttempts: 0 });
      expect(row.deletionGraceUntil!.getTime()).toBeLessThanOrEqual(Date.now());
      const assets = await prisma.asset.findMany({ where: { id: { in: video.videoAssetIds } } });
      expect(assets.every((asset) => asset.status === 'DELETING' && (asset.metadata as { deletion?: { previousStatus?: string } }).deletion?.previousStatus === 'AVAILABLE')).toBe(true);
      expect((await prisma.asset.findUniqueOrThrow({ where: { id: video.asset.voiceSample } })).status).toBe('AVAILABLE');
      expect(await prisma.auditEvent.count({ where: { entityId: video.ids.video, action: 'VIDEO_DELETION_REQUESTED' } })).toBe(1);
    });

    it('cancels an active job so the worker can no longer commit, and sets a grace window', async () => {
      const video = await seed({ jobStatus: 'WAITING_FOR_GPU' });
      const response = await del(video.ids.video, 1);
      expect(response.json().data.cancelledJobIds).toEqual([video.ids.job]);
      expect((await prisma.pipelineJob.findUniqueOrThrow({ where: { id: video.ids.job } })).status).toBe('CANCELLED');
      expect((await prisma.pipelineTask.findUniqueOrThrow({ where: { id: video.ids.task } })).status).toBe('CANCELLED');
      expect((await prisma.taskAttempt.findUniqueOrThrow({ where: { id: video.ids.attempt } })).status).toBe('CANCELLED');
      expect((await prisma.taskLease.findUniqueOrThrow({ where: { id: video.ids.lease } })).releasedAt).not.toBeNull();
      const row = await prisma.video.findUniqueOrThrow({ where: { id: video.ids.video } });
      expect(row.deletionGraceUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    });

    it('refuses a video with publication proof and changes nothing', async () => {
      const video = await seed({ withProof: true });
      const response = await del(video.ids.video, 1);
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('VIDEO_HAS_PUBLICATION_HISTORY');
      expect((await prisma.video.findUniqueOrThrow({ where: { id: video.ids.video } })).status).toBe('READY_TO_PUBLISH');
      expect(await prisma.asset.count({ where: { id: { in: video.videoAssetIds }, status: 'DELETING' } })).toBe(0);
    });

    it('is idempotent, rejects stale versions and reused keys', async () => {
      const video = await seed(); const key = randomUUID();
      const first = await del(video.ids.video, 1, key);
      const replay = await del(video.ids.video, 1, key);
      expect(replay.statusCode).toBe(202);
      expect(replay.json().data).toEqual(first.json().data);
      const again = await del(video.ids.video, 1);
      expect(again.statusCode).toBe(202);
      expect(await prisma.auditEvent.count({ where: { entityId: video.ids.video, action: 'VIDEO_DELETION_REQUESTED' } })).toBe(1);
      const other = await seed();
      expect((await del(other.ids.video, 7)).statusCode).toBe(412);
      expect((await del(other.ids.video, 7)).json().code).toBe('VIDEO_VERSION_CONFLICT');
      const reused = await del(other.ids.video, 1, key);
      expect(reused.statusCode).toBe(409);
      expect(reused.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect((await app.inject({ method: 'DELETE', url: `/v1/videos/${other.ids.video}`, headers: { 'idempotency-key': randomUUID() } })).statusCode).toBe(400);
    });

    it('re-arms a DELETE_FAILED video', async () => {
      const video = await seed();
      await prisma.video.update({ where: { id: video.ids.video }, data: { status: 'DELETE_FAILED', deletionAttempts: 6, deletionErrorCode: 'STORAGE_DELETE_FAILED', deletionRequestedAt: new Date() } });
      const response = await del(video.ids.video, 1);
      expect(response.statusCode).toBe(202);
      expect(await prisma.video.findUniqueOrThrow({ where: { id: video.ids.video } })).toMatchObject({ status: 'DELETING', deletionAttempts: 0, deletionErrorCode: null });
    });

    it('handles a mixed bulk request item by item, in request order', async () => {
      const ok = await seed(); const published = await seed({ withProof: true }); const stale = await seed(); const deleting = await seed();
      await del(deleting.ids.video, 1);
      const missing = '0191f3d2-7f5b-7abc-8b2e-00000000dead';
      const response = await app.inject({ method: 'POST', url: '/v1/videos/deletions', headers: { 'idempotency-key': randomUUID() }, payload: { items: [
        { videoId: ok.ids.video, version: 1 }, { videoId: published.ids.video, version: 1 }, { videoId: stale.ids.video, version: 9 },
        { videoId: missing, version: 1 }, { videoId: deleting.ids.video, version: 1 },
      ] } });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.items.map((item: { result: string }) => item.result)).toEqual(['ACCEPTED', 'HAS_PUBLICATION_HISTORY', 'VERSION_CONFLICT', 'NOT_FOUND', 'ALREADY_DELETING']);
      expect((await prisma.video.findUniqueOrThrow({ where: { id: ok.ids.video } })).status).toBe('DELETING');
      expect((await prisma.video.findUniqueOrThrow({ where: { id: stale.ids.video } })).status).toBe('READY_TO_PUBLISH');
      const tooMany = await app.inject({ method: 'POST', url: '/v1/videos/deletions', headers: { 'idempotency-key': randomUUID() }, payload: { items: [] } });
      expect(tooMany.statusCode).toBe(400);
    });
  });
});
