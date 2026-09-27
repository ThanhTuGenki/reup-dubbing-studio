import { PrismaClient } from '@prisma/client';
import { collectVideoAssetIds } from '../../src/modules/video-deletion/infrastructure/video-asset-set';
import { cleanupVideoTree, seedVideoTree, type SeededVideo } from './video-deletion-fixtures';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('Video deletion with PostgreSQL', () => {
  let prisma: PrismaClient; const seeded: SeededVideo[] = [];
  beforeAll(() => { prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } }); });
  afterAll(async () => { for (const item of seeded) await cleanupVideoTree(prisma, item); await prisma?.$disconnect(); });
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
});
