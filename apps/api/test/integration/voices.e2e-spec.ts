import { PrismaClient } from '@prisma/client';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApplication } from '../../src/application';
import type { ProfileObjectStore } from '../../src/modules/profiles/application/asset-ports';
import { VoiceSamplesService } from '../../src/modules/voices/application/voice-samples.service';
import { PrismaVoiceSampleRepository } from '../../src/modules/voices/infrastructure/prisma-voice-sample-repository';
import type { AppConfig } from '../../src/platform/config/config';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('Voice Library API with PostgreSQL', () => {
  let app: NestFastifyApplication; let prisma: PrismaClient;
  beforeAll(async () => {
    const config: AppConfig = { nodeEnv: 'test', port: 3000, logLevel: 'error', corsOrigins: ['http://localhost:5173'], rateLimitMax: 100, rateLimitWindowMs: 60_000, healthRateLimitMax: 100, trustProxy: false, databaseUrl: databaseUrl!, settingsEncryptionKey: Buffer.alloc(32, 7).toString('base64') };
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    await prisma.channelProfileAsset.deleteMany(); await prisma.seriesProfileAsset.deleteMany();
    await prisma.publishingDestination.deleteMany(); await prisma.reviewPolicy.deleteMany(); await prisma.seriesProfile.deleteMany(); await prisma.channelProfile.deleteMany();
    await prisma.voiceProfileSample.deleteMany(); await prisma.asset.deleteMany(); await prisma.voiceProfile.deleteMany();
    await prisma.idempotencyRecord.deleteMany({ where: { scope: { contains: 'VOICE' } } });
    app = await createApplication(config);
  });
  afterAll(async () => { await app?.close(); await prisma?.$disconnect(); });

  it('validates license, commits a sample, activates and blocks revoked commercial rights', async () => {
    const invalid = await app.inject({ method: 'POST', url: '/v1/voice-profiles', headers: { 'idempotency-key': '01994429-ec00-7000-8000-000000000031' }, payload: { name: 'Invalid', primaryLanguage: 'vi', description: null, tags: [], licenseKind: 'UNKNOWN', licenseReference: null, sourceReference: null, commercialUseAllowed: true } });
    expect(invalid.statusCode).toBe(422);

    const payload = { name: 'Narrator A', primaryLanguage: 'vi', description: 'Warm narrator', tags: ['warm'], licenseKind: 'OWNED_RECORDING', licenseReference: null, sourceReference: 'Studio recording', commercialUseAllowed: true };
    const created = await app.inject({ method: 'POST', url: '/v1/voice-profiles', headers: { 'idempotency-key': '01994429-ec00-7000-8000-000000000032' }, payload });
    expect(created.statusCode).toBe(201); expect(created.headers.etag).toBe('"1"');
    const voiceId = created.json().data.id as string;
    const premature = await app.inject({ method: 'POST', url: `/v1/voice-profiles/${voiceId}/activate`, headers: { 'if-match': '"1"' } });
    expect(premature.statusCode).toBe(409); expect(premature.json()).toMatchObject({ code: 'VOICE_NOT_READY' });

    const store: ProfileObjectStore = {
      target: async () => ({ bucket: 'voice-test' }),
      createUploadGrant: async () => ({ url: 'https://example.invalid/upload?signature=secret', headers: { 'Content-Type': 'audio/wav' }, expiresAt: new Date('2026-09-20T12:10:00.000Z') }),
      createPreviewGrant: async () => ({ url: 'https://example.invalid/preview?signature=secret', expiresAt: new Date('2026-09-20T12:05:00.000Z') }),
      inspect: async () => ({ byteSize: 128, contentType: 'audio/wav' }),
    };
    const samples = new VoiceSamplesService(new PrismaVoiceSampleRepository(prisma), store);
    const grant = await samples.requestUpload(voiceId, { language: 'vi', transcript: 'Xin chào thế giới', durationMs: 5000, fileName: 'sample.wav', contentType: 'audio/wav', byteSize: 128 });
    const pendingAsset = await prisma.asset.findUniqueOrThrow({ where: { id: grant.assetId } });
    expect(JSON.stringify({ bucket: pendingAsset.bucket, objectKey: pendingAsset.objectKey, metadata: pendingAsset.metadata })).not.toContain('signature=secret');
    const committed = await samples.commit(voiceId, grant.assetId, 1, '01994429-ec00-7000-8000-000000000033');
    expect(committed).toMatchObject({ profileVersion: 2, sample: { language: 'vi', revision: 1 } });
    await expect(samples.commit(voiceId, grant.assetId, 1, '01994429-ec00-7000-8000-000000000033')).resolves.toEqual(committed);
    const commitRecord = await prisma.idempotencyRecord.findUniqueOrThrow({ where: { scope_key: { scope: 'COMMIT_VOICE_SAMPLE', key: '01994429-ec00-7000-8000-000000000033' } } });
    expect(JSON.stringify(commitRecord)).not.toMatch(/signature=secret|example\.invalid/u);
    const sampleId = (committed.sample as { id: string }).id;
    await expect(samples.preview(voiceId, sampleId)).resolves.toMatchObject({ method: 'GET', fileName: 'sample.wav' });

    const activated = await app.inject({ method: 'POST', url: `/v1/voice-profiles/${voiceId}/activate`, headers: { 'if-match': '"2"' } });
    expect(activated.statusCode).toBe(200); expect(activated.headers.etag).toBe('"3"');
    expect(activated.json().data).toMatchObject({ status: 'READY', readiness: 'READY' });

    const activateReplay = await app.inject({ method: 'POST', url: `/v1/voice-profiles/${voiceId}/activate`, headers: { 'if-match': '"3"' } });
    expect(activateReplay.statusCode).toBe(200); expect(activateReplay.headers.etag).toBe('"3"');

    const languageChanged = await app.inject({ method: 'PATCH', url: `/v1/voice-profiles/${voiceId}`, headers: { 'if-match': '"3"' }, payload: { primaryLanguage: 'en' } });
    expect(languageChanged.statusCode).toBe(200);
    expect(languageChanged.json().data).toMatchObject({ status: 'DRAFT', readiness: 'NEEDS_CONFIGURATION', readinessIssues: ['VOICE_PRIMARY_SAMPLE_REQUIRED'] });
    const languageRestored = await app.inject({ method: 'PATCH', url: `/v1/voice-profiles/${voiceId}`, headers: { 'if-match': '"4"' }, payload: { primaryLanguage: 'vi' } });
    expect(languageRestored.json().data).toMatchObject({ status: 'DRAFT', readiness: 'READY' });
    const reactivated = await app.inject({ method: 'POST', url: `/v1/voice-profiles/${voiceId}/activate`, headers: { 'if-match': '"5"' } });
    expect(reactivated.headers.etag).toBe('"6"');

    const replacementGrant = await samples.requestUpload(voiceId, { language: 'vi', transcript: 'Xin chào lần hai', durationMs: 6000, fileName: 'sample-v2.wav', contentType: 'audio/wav', byteSize: 128 });
    const replacement = await samples.commit(voiceId, replacementGrant.assetId, 6, '01994429-ec00-7000-8000-000000000035');
    expect(replacement).toMatchObject({ profileVersion: 7, sample: { revision: 2 } });
    await expect(samples.preview(voiceId, sampleId)).rejects.toMatchObject({ code: 'VOICE_SAMPLE_NOT_AVAILABLE' });
    await app.inject({ method: 'POST', url: `/v1/voice-profiles/${voiceId}/activate`, headers: { 'if-match': '"7"' } });
    await expect(samples.detach(voiceId, (replacement.sample as { id: string }).id, 8)).rejects.toMatchObject({ code: 'VOICE_NOT_READY' });

    const revoked = await app.inject({ method: 'PATCH', url: `/v1/voice-profiles/${voiceId}`, headers: { 'if-match': '"8"' }, payload: { licenseKind: 'CC_BY_NC' } });
    expect(revoked.statusCode).toBe(200); expect(revoked.json().data).toMatchObject({ status: 'BLOCKED_LICENSE', commercialUseAllowed: false });
    const list = await app.inject({ method: 'GET', url: '/v1/voice-profiles?language=vi&commercialUseAllowed=false' });
    expect(list.json().data.items).toHaveLength(1);
  });
});
