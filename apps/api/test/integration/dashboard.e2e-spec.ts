import { PrismaClient } from '@prisma/client';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApplication } from '../../src/application';
import type { AppConfig } from '../../src/platform/config/config';
import { uuidV7 } from '../../src/platform/ids/uuid-v7';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('Dashboard API with PostgreSQL', () => {
  let app: NestFastifyApplication; let prisma: PrismaClient;
  const ids = { user: uuidV7(), channel: uuidV7(), source: uuidV7(), video: uuidV7(), job: uuidV7(), workflow: uuidV7(), account: uuidV7(), credential: uuidV7(), image: uuidV7(), worker: uuidV7(), billing: uuidV7() };
  const config: AppConfig = { nodeEnv: 'test', port: 3000, logLevel: 'fatal', corsOrigins: ['http://localhost:5173'], rateLimitMax: 1000, rateLimitWindowMs: 60_000, healthRateLimitMax: 100, trustProxy: false, databaseUrl: databaseUrl!, settingsEncryptionKey: Buffer.alloc(32, 6).toString('base64') };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    const now = new Date();
    await prisma.user.create({ data: { id: ids.user, displayName: 'Dashboard test user' } });
    await prisma.channelProfile.create({ data: { id: ids.channel, name: 'Dashboard channel', normalizedName: `dashboard-${ids.channel}`, status: 'ACTIVE', targetLanguage: 'vi', subtitleLanguage: 'vi', subtitleFilenameRule: '{slug}.vi.srt' } });
    await prisma.sourceContent.create({ data: { id: ids.source, platform: 'DOUYIN', externalId: `dashboard-${ids.source}`, contentType: 'VIDEO', firstSeenAt: now, lastSeenAt: now } });
    await prisma.video.create({ data: { id: ids.video, sourceContentId: ids.source, channelProfileId: ids.channel, status: 'FAILED', sourceLanguage: 'zh', targetLanguage: 'vi', displayTitle: 'Dashboard failed video', createdById: ids.user } });
    await prisma.pipelineJob.create({ data: { id: ids.job, videoId: ids.video, kind: 'FULL_PIPELINE', status: 'FAILED', pipelineVersion: 'dashboard-test', profileSnapshot: {}, requestedOutputs: {}, failureCode: 'DASHBOARD_TEST_FAILURE' } });
    await prisma.workflowEvent.create({ data: { id: ids.workflow, videoId: ids.video, pipelineJobId: ids.job, eventType: 'JOB_FAILED', toStatus: 'FAILED', actorType: 'SYSTEM', messageSafe: 'Test failure' } });
    await prisma.sourceAccount.create({ data: { id: ids.account, platform: 'DOUYIN', displayName: 'Cookie hết hạn', status: 'EXPIRED' } });
    await prisma.sourceCredential.create({ data: { id: ids.credential, sourceAccountId: ids.account, kind: 'NETSCAPE_COOKIE', ciphertext: Buffer.from('encrypted-test'), encryptionKeyId: 'test', encryptedAt: now, expiresAt: new Date(now.valueOf() - 1_000) } });
    await prisma.approvedWorkerImage.create({ data: { id: ids.image, role: 'BATCH_MEDIA', semanticVersion: '1.0.0', imageDigest: `sha256:${'d'.repeat(64)}`, registryRef: 'ghcr.io/reup/dashboard-test', contractVersion: 1 } });
    await prisma.worker.create({ data: { id: ids.worker, displayName: 'Worker cần tắt', role: 'BATCH_MEDIA', provider: 'EzyCloudX', desiredStatus: 'DRAINING', observedStatus: 'SAFE_TO_TERMINATE', approvedImageId: ids.image } });
    await prisma.workerBillingSession.create({ data: { id: ids.billing, workerId: ids.worker, provider: 'EzyCloudX', hourlyRateCp: '10', paidVndPerCp: '25', billingStartedAt: new Date(now.valueOf() - 60 * 60 * 1_000) } });
    app = await createApplication(config);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.workerBillingSession.deleteMany({ where: { id: ids.billing } }); await prisma?.worker.deleteMany({ where: { id: ids.worker } }); await prisma?.approvedWorkerImage.deleteMany({ where: { id: ids.image } });
    await prisma?.sourceCredential.deleteMany({ where: { id: ids.credential } }); await prisma?.sourceAccount.deleteMany({ where: { id: ids.account } });
    await prisma?.workflowEvent.deleteMany({ where: { id: ids.workflow } }); await prisma?.pipelineJob.deleteMany({ where: { id: ids.job } }); await prisma?.video.deleteMany({ where: { id: ids.video } }); await prisma?.sourceContent.deleteMany({ where: { id: ids.source } }); await prisma?.channelProfile.deleteMany({ where: { id: ids.channel } }); await prisma?.user.deleteMany({ where: { id: ids.user } }); await prisma?.$disconnect();
  });

  it('aggregates counts, live billing, attention and safe activity without secrets', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/dashboard' });
    expect(response.statusCode).toBe(200);
    const dashboard = response.json().data;
    expect(dashboard.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(dashboard.videos.failed).toBeGreaterThanOrEqual(1);
    expect(dashboard.queue.failed).toBeGreaterThanOrEqual(1);
    expect(dashboard.workers.safeToTerminate).toBeGreaterThanOrEqual(1);
    expect(Number(dashboard.cost.estimatedCostCp)).toBeGreaterThanOrEqual(10);
    expect(dashboard.cost.vndCoverage).toBe('COMPLETE');
    expect(dashboard.attention.items.map((item: { code: string }) => item.code)).toEqual(expect.arrayContaining(['WORKER_BILLING_SAFE_TO_TERMINATE', 'SOURCE_CREDENTIAL_EXPIRED', 'QUEUE_JOB_FAILED']));
    expect(dashboard.recentActivity.items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'QUEUE_EVENT', entityId: ids.job })]));
    expect(JSON.stringify(dashboard)).not.toMatch(/ciphertext|objectKey|signedUrl|encrypted-test/iu);
  });
});
