import { PrismaClient } from '@prisma/client';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApplication } from '../../src/application';
import type { AppConfig } from '../../src/platform/config/config';
import { uuidV7 } from '../../src/platform/ids/uuid-v7';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
describeWithDatabase('Video Library API with PostgreSQL', () => {
  let app: NestFastifyApplication; let prisma: PrismaClient; let channelId: string; let activeId: string; let archivedId: string;
  const config: AppConfig = { nodeEnv: 'test', port: 3000, logLevel: 'fatal', corsOrigins: ['http://localhost:5173'], rateLimitMax: 100, rateLimitWindowMs: 60_000, healthRateLimitMax: 100, trustProxy: false, databaseUrl: databaseUrl!, settingsEncryptionKey: Buffer.alloc(32, 8).toString('base64') };
  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    const userId = uuidV7(); const activeSourceId = uuidV7(); const archivedSourceId = uuidV7(); channelId = uuidV7(); activeId = uuidV7(); archivedId = uuidV7();
    await prisma.user.create({ data: { id: userId, displayName: 'Library test user' } });
    await prisma.channelProfile.create({ data: { id: channelId, name: 'Library channel', normalizedName: 'library channel', status: 'ACTIVE', targetLanguage: 'vi', subtitleLanguage: 'vi', subtitleFilenameRule: '{slug}.srt' } });
    const now = new Date();
    await prisma.sourceContent.createMany({ data: [{ id: activeSourceId, platform: 'DOUYIN', externalId: `active-${activeId}`, contentType: 'VIDEO', title: 'Active library video', canonicalUrl: 'https://douyin.test/active', availability: 'AVAILABLE', firstSeenAt: now, lastSeenAt: now }, { id: archivedSourceId, platform: 'DOUYIN', externalId: `archived-${archivedId}`, contentType: 'VIDEO', title: 'Archived library video', availability: 'AVAILABLE', firstSeenAt: now, lastSeenAt: now }] });
    await prisma.video.createMany({ data: [{ id: activeId, sourceContentId: activeSourceId, channelProfileId: channelId, status: 'READY_TO_PUBLISH', sourceLanguage: 'zh', targetLanguage: 'vi', displayTitle: 'Active library video', createdById: userId, updatedAt: new Date(now.getTime() + 2_000) }, { id: archivedId, sourceContentId: archivedSourceId, channelProfileId: channelId, status: 'ARCHIVED', sourceLanguage: 'zh', targetLanguage: 'vi', displayTitle: 'Archived library video', createdById: userId, updatedAt: now }] });
    app = await createApplication(config);
  });
  afterAll(async () => { await app?.close(); await prisma?.video.deleteMany({ where: { id: { in: [activeId, archivedId] } } }); await prisma?.sourceContent.deleteMany({ where: { externalId: { in: [`active-${activeId}`, `archived-${archivedId}`] } } }); await prisma?.channelProfile.delete({ where: { id: channelId } }); await prisma?.user.deleteMany({ where: { displayName: 'Library test user' } }); await prisma?.$disconnect(); });
  it('excludes archived videos by default and supports cursor/filter/detail ETag', async () => {
    const first = await app.inject({ method: 'GET', url: '/v1/videos?limit=1&platform=DOUYIN&query=active' });
    expect(first.statusCode).toBe(200); expect(first.json().data.items).toHaveLength(1); expect(first.json().data.items[0].id).toBe(activeId); expect(first.json().data.items[0]).not.toHaveProperty('bucket'); expect(first.json().data.items[0]).not.toHaveProperty('objectKey');
    const detail = await app.inject({ method: 'GET', url: `/v1/videos/${activeId}` }); expect(detail.statusCode).toBe(200); expect(detail.headers.etag).toBe('"1"'); expect(detail.json().data.id).toBe(activeId);
    const archived = await app.inject({ method: 'GET', url: '/v1/videos?includeArchived=true&query=archived' }); expect(archived.statusCode).toBe(200); expect(archived.json().data.items[0].status).toBe('ARCHIVED');
  });
  it('returns an empty page for unmatched filters and a safe not-found problem', async () => {
    const empty = await app.inject({ method: 'GET', url: '/v1/videos?query=does-not-exist' }); expect(empty.statusCode).toBe(200); expect(empty.json().data.items).toEqual([]); expect(empty.json().data.nextCursor).toBeNull();
    const missing = await app.inject({ method: 'GET', url: `/v1/videos/${uuidV7()}` }); expect(missing.statusCode).toBe(404); expect(missing.json().code).toBe('VIDEO_NOT_FOUND');
  });
});
