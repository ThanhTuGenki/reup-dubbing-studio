import { PrismaClient } from '@prisma/client';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApplication } from '../../src/application';
import type { AppConfig } from '../../src/platform/config/config';
import { DiscoveryRunner } from '../../src/modules/discovery/application/discovery-runner';
import type { SourceDiscoveryProvider } from '../../src/modules/discovery/application/ports';
import { PrismaDiscoveryRepository } from '../../src/modules/discovery/infrastructure/prisma-discovery-repository';
import { AesGcmSourceCredentialCipher } from '../../src/modules/discovery/infrastructure/source-credential-cipher';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('Discovery API with PostgreSQL', () => {
  let app: NestFastifyApplication; let prisma: PrismaClient;
  const cookie = '.douyin.com\tTRUE\t/\tTRUE\t0\tttwid\tnever-persist-this-plaintext';
  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    await prisma.sourceRawEvent.deleteMany(); await prisma.discoveryItem.deleteMany(); await prisma.discoveryRun.deleteMany();
    await prisma.watchlist.deleteMany(); await prisma.sourceContentCategory.deleteMany(); await prisma.contentMetricSnapshot.deleteMany();
    await prisma.sourceMediaCandidate.deleteMany(); await prisma.sourceContent.deleteMany(); await prisma.sourceCreator.deleteMany();
    await prisma.sourceCredential.deleteMany(); await prisma.sourceAccount.deleteMany();
    await prisma.idempotencyRecord.deleteMany({ where: { scope: { in: ['CREATE_SOURCE_ACCOUNT', 'CREATE_DISCOVERY_RUN', 'CREATE_WATCHLIST'] } } });
    const config: AppConfig = { nodeEnv: 'test', port: 3000, logLevel: 'error', corsOrigins: ['http://localhost:5173'], rateLimitMax: 100, rateLimitWindowMs: 60_000, healthRateLimitMax: 100, trustProxy: false, databaseUrl: databaseUrl!, settingsEncryptionKey: Buffer.alloc(32, 7).toString('base64') };
    app = await createApplication(config);
  });
  afterAll(async () => { await app?.close(); await prisma?.$disconnect(); });

  it('rotates an encrypted cookie and never echoes or stores plaintext', async () => {
    const created = await app.inject({ method: 'POST', url: '/v1/source-accounts', headers: { 'idempotency-key': '01994429-ec00-7000-8000-000000000061' }, payload: { platform: 'DOUYIN', displayName: 'Douyin chính' } });
    expect(created.statusCode).toBe(201); const accountId = created.json().data.id as string;
    const imported = await app.inject({ method: 'POST', url: `/v1/source-accounts/${accountId}/credentials`, payload: { netscapeCookie: cookie } });
    expect(imported.statusCode).toBe(200); expect(imported.body).not.toContain('never-persist-this-plaintext'); expect(imported.json().data).toMatchObject({ status: 'ACTIVE', credential: { kind: 'NETSCAPE_COOKIE' } });
    const stored = await prisma.sourceCredential.findFirstOrThrow({ where: { sourceAccountId: accountId, revokedAt: null } });
    expect(Buffer.from(stored.ciphertext).toString('utf8')).not.toContain('never-persist-this-plaintext');
    const second = await app.inject({ method: 'POST', url: `/v1/source-accounts/${accountId}/credentials`, payload: { netscapeCookie: cookie.replace('plaintext', 'rotated') } });
    expect(second.statusCode).toBe(200); expect(await prisma.sourceCredential.count({ where: { sourceAccountId: accountId, revokedAt: null } })).toBe(1);
  });

  it('returns fallback categories, rejects disabled modes and creates asynchronous runs', async () => {
    const accounts = await app.inject({ method: 'GET', url: '/v1/source-accounts?platform=DOUYIN' }); const accountId = accounts.json().data.items[0].id as string;
    const categories = await app.inject({ method: 'GET', url: '/v1/discovery/categories?platform=DOUYIN' }); expect(categories.json().data.items).toHaveLength(17);
    const disabled = await app.inject({ method: 'POST', url: '/v1/discovery/runs', headers: { 'idempotency-key': '01994429-ec00-7000-8000-000000000062' }, payload: { sourceAccountId: accountId, mode: 'SEARCH_VIDEO', query: 'test', requestedLimit: 20 } });
    expect(disabled.statusCode).toBe(409); expect(disabled.json()).toMatchObject({ code: 'DISCOVERY_MODE_DISABLED' });
    const created = await app.inject({ method: 'POST', url: '/v1/discovery/runs', headers: { 'idempotency-key': '01994429-ec00-7000-8000-000000000063' }, payload: { sourceAccountId: accountId, mode: 'JINGXUAN', requestedLimit: 20 } });
    expect(created.statusCode).toBe(202); expect(created.json().data).toMatchObject({ status: 'QUEUED', mode: 'JINGXUAN' });
    const runId = created.json().data.id as string;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const run = await app.inject({ method: 'GET', url: `/v1/discovery/runs/${runId}` }); expect(run.json().data).toMatchObject({ status: 'FAILED', errorCode: 'DISCOVERY_PROVIDER_UNAVAILABLE' });
    expect(run.body).not.toMatch(/cookie|never-persist-this/iu);
  });

  it('blocks runs for an expired cookie and rejects malformed internal cursors', async () => {
    const created = await app.inject({ method: 'POST', url: '/v1/source-accounts', headers: { 'idempotency-key': '01994429-ec00-7000-8000-000000000069' }, payload: { platform: 'DOUYIN', displayName: 'Cookie hết hạn' } });
    const accountId = created.json().data.id as string;
    const expiredCookie = '.douyin.com\tTRUE\t/\tTRUE\t1\tttwid\texpired-secret';
    const imported = await app.inject({ method: 'POST', url: `/v1/source-accounts/${accountId}/credentials`, payload: { netscapeCookie: expiredCookie } });
    expect(imported.json().data).toMatchObject({ status: 'EXPIRED' }); expect(imported.body).not.toContain('expired-secret');
    const blocked = await app.inject({ method: 'POST', url: '/v1/discovery/runs', headers: { 'idempotency-key': '01994429-ec00-7000-8000-000000000070' }, payload: { sourceAccountId: accountId, mode: 'JINGXUAN', requestedLimit: 20 } });
    expect(blocked.statusCode).toBe(409); expect(blocked.json()).toMatchObject({ code: 'SOURCE_ACCOUNT_CREDENTIAL_REQUIRED' });
    const cursor = await app.inject({ method: 'GET', url: '/v1/discovery/items?cursor=not-an-internal-cursor' });
    expect(cursor.statusCode).toBe(422); expect(cursor.json()).toMatchObject({ code: 'DISCOVERY_CURSOR_INVALID' });
  });

  it('manages creator watchlists with version checks and deduplication', async () => {
    const accounts = await app.inject({ method: 'GET', url: '/v1/source-accounts?platform=DOUYIN' }); const accountId = accounts.json().data.items[0].id as string;
    const payload = { sourceAccountId: accountId, mode: 'CREATOR', input: 'https://www.douyin.com/user/MS4wLjABAAAAopaque', displayName: 'Tác giả A', scheduleIntervalMin: 60 };
    const created = await app.inject({ method: 'POST', url: '/v1/watchlists', headers: { 'idempotency-key': '01994429-ec00-7000-8000-000000000064' }, payload });
    expect(created.statusCode).toBe(201); expect(created.headers.etag).toBe('"1"'); const id = created.json().data.id as string;
    const duplicate = await app.inject({ method: 'POST', url: '/v1/watchlists', headers: { 'idempotency-key': '01994429-ec00-7000-8000-000000000065' }, payload: { ...payload, displayName: 'Trùng' } }); expect(duplicate.statusCode).toBe(409);
    const stale = await app.inject({ method: 'PATCH', url: `/v1/watchlists/${id}`, headers: { 'if-match': '"2"' }, payload: { status: 'PAUSED' } }); expect(stale.statusCode).toBe(409);
    const updated = await app.inject({ method: 'PATCH', url: `/v1/watchlists/${id}`, headers: { 'if-match': '"1"' }, payload: { status: 'PAUSED' } }); expect(updated.json().data).toMatchObject({ status: 'PAUSED', version: 2 });
    const removed = await app.inject({ method: 'DELETE', url: `/v1/watchlists/${id}`, headers: { 'if-match': '"2"' } }); expect(removed.statusCode).toBe(200);
  });

  it('persists fake-provider pages with dedupe, null metrics, internal cursor and sanitized URLs', async () => {
    const account = await prisma.sourceAccount.findFirstOrThrow({ where: { platform: 'DOUYIN' } });
    const repository = new PrismaDiscoveryRepository(prisma);
    const cipher = new AesGcmSourceCredentialCipher(Buffer.alloc(32, 7).toString('base64'));
    const provider: SourceDiscoveryProvider = {
      validate: async () => 'ACTIVE',
      scan: async () => ({ hasMore: false, nextCursor: { maxCursor: 'provider-secret-cursor' }, skippedCounts: { LIVE: 1 }, items: [
        { externalId: '999999999999999999999999999999', contentType: 'VIDEO', title: 'Video lớn', canonicalUrl: 'https://www.douyin.com/video/999999999999999999999999999999?msToken=secret', availability: 'AVAILABLE', isIngestEligible: true, creator: { externalId: 'creator-large', nickname: 'Creator' }, metrics: { playCount: null, diggCount: '42' }, media: [{ role: 'COVER', url: 'https://p.douyin.com/cover.jpg?signature=secret&size=large' }, { role: 'PLAYBACK', url: 'https://v.douyin.com/play.mp4?a_bogus=secret' }] },
        { externalId: '999999999999999999999999999999', contentType: 'VIDEO', availability: 'AVAILABLE', isIngestEligible: true },
        { externalId: '100000000000000000000000000001', contentType: 'NOTE', availability: 'AVAILABLE', isIngestEligible: false },
      ] }),
    };
    const run = await repository.createRun({ sourceAccountId: account.id, mode: 'JINGXUAN', requestedLimit: 20 }, '01994429-ec00-7000-8000-000000000066', 'fake-provider-run');
    await new DiscoveryRunner(repository, cipher, provider).execute(run.id);
    const stored = await prisma.discoveryRun.findUniqueOrThrow({ where: { id: run.id } }); expect(stored).toMatchObject({ status: 'SUCCEEDED', itemCount: 2, pageCount: 1 });
    const contents = await prisma.sourceContent.findMany({ where: { platform: 'DOUYIN' }, include: { mediaCandidates: true, metricSnapshots: true } });
    expect(contents).toHaveLength(2); expect(contents[0]?.externalId).toMatch(/^\d{30}$/u);
    expect(JSON.stringify(contents.flatMap((content) => content.mediaCandidates.map((media) => ({ canonicalUrl: media.canonicalUrl, metadata: media.metadata }))))).not.toMatch(/a_bogus|msToken|signature=secret|provider-secret-cursor/u);
    const metric = contents.flatMap((content) => content.metricSnapshots)[0]; expect(metric?.playCount).toBeNull(); expect(metric?.diggCount).toBe(42n);
    const first = await app.inject({ method: 'GET', url: `/v1/discovery/items?runId=${run.id}&limit=1` });
    expect(first.json().data.items).toHaveLength(1); expect(first.json().data.nextCursor).toBeTruthy(); expect(first.body).not.toContain('provider-secret-cursor');
    const second = await app.inject({ method: 'GET', url: `/v1/discovery/items?runId=${run.id}&limit=1&cursor=${encodeURIComponent(first.json().data.nextCursor)}` }); expect(second.json().data.items).toHaveLength(1);

    const repeated = await repository.createRun({ sourceAccountId: account.id, mode: 'JINGXUAN', requestedLimit: 20 }, '01994429-ec00-7000-8000-000000000071', 'repeat-provider-run');
    await new DiscoveryRunner(repository, cipher, provider).execute(repeated.id);
    expect(await prisma.sourceContent.count({ where: { platform: 'DOUYIN' } })).toBe(2);
    expect(await repository.run(repeated.id)).toMatchObject({ status: 'SUCCEEDED', itemCount: 2 });

    let calls = 0;
    const partialProvider: SourceDiscoveryProvider = { validate: async () => 'ACTIVE', scan: async () => { calls += 1; if (calls > 1) throw Object.assign(new Error('rate limited token=private'), { code: 'DISCOVERY_RATE_LIMITED' }); return { hasMore: true, nextCursor: { maxCursor: 'opaque' }, skippedCounts: {}, items: [{ externalId: 'partial-1', contentType: 'VIDEO', availability: 'AVAILABLE', isIngestEligible: true }] }; } };
    const partial = await repository.createRun({ sourceAccountId: account.id, mode: 'JINGXUAN', requestedLimit: 20 }, '01994429-ec00-7000-8000-000000000067', 'partial-provider-run');
    await new DiscoveryRunner(repository, cipher, partialProvider).execute(partial.id);
    expect(await repository.run(partial.id)).toMatchObject({ status: 'PARTIAL', itemCount: 1, errorCode: 'DISCOVERY_RATE_LIMITED' });
    expect(JSON.stringify(await repository.run(partial.id))).not.toContain('private');

    const cancellable = await repository.createRun({ sourceAccountId: account.id, mode: 'JINGXUAN', requestedLimit: 20 }, '01994429-ec00-7000-8000-000000000068', 'cancel-run');
    expect(await repository.cancelRun(cancellable.id)).toMatchObject({ status: 'CANCELLED' });
    expect(await repository.cancelRun(cancellable.id)).toMatchObject({ status: 'CANCELLED' });
  });
});
