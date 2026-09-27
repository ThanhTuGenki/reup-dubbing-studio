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
});
