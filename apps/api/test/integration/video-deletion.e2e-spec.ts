import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApplication } from '../../src/application';
import type { AppConfig } from '../../src/platform/config/config';
import { ControlPlaneRunner } from '../../src/modules/workers/application/control-plane-runner';
import { PipelineOrchestrator } from '../../src/modules/workers/infrastructure/pipeline-orchestrator';
import { VideoDeletionRunner } from '../../src/modules/video-deletion/application/video-deletion-runner';
import { VideoDeletionError } from '../../src/modules/video-deletion/domain/video-deletion-errors';
import { PrismaVideoDeletionRepository } from '../../src/modules/video-deletion/infrastructure/prisma-video-deletion-repository';
import { collectVideoAssetIds } from '../../src/modules/video-deletion/infrastructure/video-asset-set';
import { cleanupVideoTree, seedVideoTree, type SeededVideo } from './video-deletion-fixtures';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

class FakeObjectStore {
  deleted: string[] = [];
  failures = 0;
  async deleteObject(_bucket: string | null, key: string) {
    if (this.failures > 0) { this.failures -= 1; throw new VideoDeletionError('STORAGE_DELETE_FAILED', 'boom'); }
    this.deleted.push(key);
  }
}

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
      expect(detail.json().data.capabilities).toMatchObject({ canDelete: false, deleteBlockedReason: 'DELETING', canOpenStudio: false });
      const failedDetail = await app.inject({ method: 'GET', url: `/v1/videos/${failed.ids.video}` });
      expect(failedDetail.json().data.capabilities).toMatchObject({ canOpenStudio: true });
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

    it('replays a bulk request with the same key and rejects the key for another body', async () => {
      const first = await seed(); const second = await seed(); const key = randomUUID();
      const bulk = (items: Array<{ videoId: string; version: number }>) => app.inject({ method: 'POST', url: '/v1/videos/deletions', headers: { 'idempotency-key': key }, payload: { items } });
      const items = [{ videoId: first.ids.video, version: 1 }, { videoId: second.ids.video, version: 1 }];
      const original = await bulk(items);
      const replay = await bulk(items);
      expect(original.statusCode).toBe(200);
      expect(replay.statusCode).toBe(200);
      expect(replay.json().data).toEqual(original.json().data);
      for (const video of [first, second]) {
        expect(await prisma.auditEvent.count({ where: { entityId: video.ids.video, action: 'VIDEO_DELETION_REQUESTED' } })).toBe(1);
      }
      const reused = await bulk([{ videoId: first.ids.video, version: 1 }]);
      expect(reused.statusCode).toBe(409);
      expect(reused.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
    });
  });

  describe('other modules on a deleting video', () => {
    const del = (videoId: string, version: number) => app.inject({ method: 'DELETE', url: `/v1/videos/${videoId}`, headers: { 'if-match': `"${version}"`, 'idempotency-key': randomUUID() } });

    it('refuses a queue retry of a failed job and keeps the video DELETING', async () => {
      const video = await seed({ jobStatus: 'FAILED' });
      await prisma.pipelineJob.update({ where: { id: video.ids.job }, data: { failureCode: 'WORKER_LOST' } });
      await prisma.pipelineTask.update({ where: { id: video.ids.task }, data: { status: 'FAILED' } });
      expect((await del(video.ids.video, 1)).statusCode).toBe(202);
      const job = await prisma.pipelineJob.findUniqueOrThrow({ where: { id: video.ids.job } });
      const retry = await app.inject({ method: 'POST', url: `/v1/queue/jobs/${video.ids.job}/retry`, headers: { 'if-match': `"${job.version}"`, 'idempotency-key': `retry-deleting-${randomUUID()}` }, payload: {} });
      expect(retry.statusCode).toBe(409);
      expect(retry.json().code).toBe('VIDEO_DELETING');
      expect((await prisma.pipelineJob.findUniqueOrThrow({ where: { id: video.ids.job } })).status).toBe('FAILED');
      expect((await prisma.video.findUniqueOrThrow({ where: { id: video.ids.video } })).status).toBe('DELETING');
    });

    it('refuses studio edit, review, render and regenerate on DELETING and DELETE_FAILED videos', async () => {
      const deleting = await seed(); const failed = await seed();
      expect((await del(deleting.ids.video, 1)).statusCode).toBe(202);
      await prisma.video.update({ where: { id: failed.ids.video }, data: { status: 'DELETE_FAILED', deletionRequestedAt: new Date(), deletionErrorCode: 'STORAGE_DELETE_FAILED' } });
      for (const video of [deleting, failed]) {
        const { version } = await prisma.video.findUniqueOrThrow({ where: { id: video.ids.video } });
        const headers = { 'if-match': `"${version}"`, 'idempotency-key': `studio-deleting-${randomUUID()}` };
        const responses = [
          await app.inject({ method: 'PATCH', url: `/v1/videos/${video.ids.video}/segments/${video.ids.segment}`, headers, payload: { translatedText: 'Không được sửa' } }),
          await app.inject({ method: 'POST', url: `/v1/videos/${video.ids.video}/review-decisions`, headers, payload: { scope: 'SCRIPT', subjectVersion: String(version), decision: 'CHANGES_REQUESTED' } }),
          await app.inject({ method: 'POST', url: `/v1/videos/${video.ids.video}/render-requests`, headers: { ...headers, 'idempotency-key': `studio-render-${randomUUID()}` } }),
          await app.inject({ method: 'POST', url: `/v1/videos/${video.ids.video}/segments/${video.ids.segment}/regenerate`, headers: { ...headers, 'idempotency-key': `studio-regen-${randomUUID()}` } }),
        ];
        expect(responses.map((response) => [response.statusCode, response.json().code])).toEqual(Array(4).fill([409, 'VIDEO_DELETING']));
        const row = await prisma.video.findUniqueOrThrow({ where: { id: video.ids.video } });
        expect(row).toMatchObject({ version, status: video === deleting ? 'DELETING' : 'DELETE_FAILED' });
        expect(await prisma.pipelineJob.count({ where: { videoId: video.ids.video } })).toBe(1);
      }
    });

    it('does not let a finishing job overwrite the status of a video being deleted', async () => {
      const orchestrator = new PipelineOrchestrator(prisma);
      const done = await seed(); const failing = await seed({ jobStatus: 'RUNNING' });
      await prisma.video.update({ where: { id: done.ids.video }, data: { status: 'DELETING' } });
      await prisma.$transaction((tx) => orchestrator.refreshAggregateStatus(tx, done.ids.job));
      expect((await prisma.video.findUniqueOrThrow({ where: { id: done.ids.video } })).status).toBe('DELETING');

      await prisma.video.update({ where: { id: failing.ids.video }, data: { status: 'DELETE_FAILED' } });
      const task = await prisma.pipelineTask.update({ where: { id: failing.ids.task }, data: { attemptCount: 1, maxAttempts: 1 } });
      const runner = new ControlPlaneRunner(prisma, {} as never, {} as never, orchestrator, false);
      await (runner as unknown as { fail: (task: unknown, attemptId: string, detail: string) => Promise<void> }).fail(task, failing.ids.attempt, 'boom');
      expect((await prisma.pipelineJob.findUniqueOrThrow({ where: { id: failing.ids.job } })).status).toBe('FAILED');
      expect((await prisma.video.findUniqueOrThrow({ where: { id: failing.ids.video } })).status).toBe('DELETE_FAILED');
    });
  });

  describe('runner', () => {
    const del = (videoId: string) => app.inject({ method: 'DELETE', url: `/v1/videos/${videoId}`, headers: { 'if-match': '"1"', 'idempotency-key': randomUUID() } });
    const runnerWith = (store: FakeObjectStore) => new VideoDeletionRunner(new PrismaVideoDeletionRepository(prisma), store, false);
    const due = (videoId: string) => prisma.video.update({ where: { id: videoId }, data: { deletionNextAttemptAt: new Date(Date.now() - 1_000) } });
    const tickUntilIdle = async (runner: VideoDeletionRunner) => { for (let i = 0; i < 10; i += 1) await runner.tick(); };

    // The earlier 'deletion requests' describe leaves its own videos in DELETING (it never runs the
    // runner), each immediately due. Drain that backlog first so these tests only observe the objects
    // and rows they themselves create.
    beforeAll(async () => { await tickUntilIdle(runnerWith(new FakeObjectStore())); });

    it('deletes every object and every row of the video, and keeps profile assets', async () => {
      const video = await seed({ sharedWithChannel: true }); const store = new FakeObjectStore();
      await del(video.ids.video);
      await tickUntilIdle(runnerWith(store));
      expect(store.deleted.sort()).toEqual([video.asset.raw, video.asset.transcript, video.asset.audio].map((id) => `videos/${video.ids.video}/${id}`).sort());
      expect(await prisma.video.findUnique({ where: { id: video.ids.video } })).toBeNull();
      expect(await prisma.pipelineJob.count({ where: { videoId: video.ids.video } })).toBe(0);
      expect(await prisma.taskAttempt.count({ where: { id: video.ids.attempt } })).toBe(0);
      expect(await prisma.publishPackage.count({ where: { videoId: video.ids.video } })).toBe(0);
      expect(await prisma.asset.count({ where: { id: { in: [video.asset.raw, video.asset.transcript, video.asset.audio] } } })).toBe(0);
      const kept = await prisma.asset.findMany({ where: { id: { in: [video.asset.output, video.asset.voiceSample, video.asset.channelAsset] } } });
      expect(kept.map((asset) => [asset.status, asset.createdByAttemptId])).toEqual([['AVAILABLE', null], ['AVAILABLE', null], ['AVAILABLE', null]]);
      expect(await prisma.auditEvent.count({ where: { entityId: video.ids.video, action: 'VIDEO_DELETED' } })).toBe(1);
      expect((await app.inject({ method: 'GET', url: `/v1/videos/${video.ids.video}` })).statusCode).toBe(404);
    });

    it('waits for the grace window before removing a video with late PENDING uploads', async () => {
      const video = await seed({ jobStatus: 'RUNNING', pendingOutput: true }); const store = new FakeObjectStore(); const runner = runnerWith(store);
      await del(video.ids.video);
      await runner.tick();
      expect(await prisma.video.findUnique({ where: { id: video.ids.video } })).not.toBeNull();
      expect(store.deleted).not.toContain(`videos/${video.ids.video}/${video.asset.pending}`);
      await prisma.video.update({ where: { id: video.ids.video }, data: { deletionGraceUntil: new Date(Date.now() - 1_000) } });
      await due(video.ids.video);
      await tickUntilIdle(runner);
      expect(store.deleted).toContain(`videos/${video.ids.video}/${video.asset.pending}`);
      expect(await prisma.video.findUnique({ where: { id: video.ids.video } })).toBeNull();
    });

    it('retries storage failures with backoff and fails for good after six attempts', async () => {
      const flaky = await seed(); const store = new FakeObjectStore(); const runner = runnerWith(store);
      await del(flaky.ids.video);
      store.failures = 3;
      for (let i = 0; i < 3; i += 1) { await runner.tick(); await due(flaky.ids.video); }
      expect((await prisma.video.findUniqueOrThrow({ where: { id: flaky.ids.video } })).deletionAttempts).toBe(3);
      await tickUntilIdle(runner);
      expect(await prisma.video.findUnique({ where: { id: flaky.ids.video } })).toBeNull();

      const broken = await seed(); store.failures = 6;
      await del(broken.ids.video);
      for (let i = 0; i < 6; i += 1) { await runner.tick(); await prisma.video.updateMany({ where: { id: broken.ids.video, status: 'DELETING' }, data: { deletionNextAttemptAt: new Date(Date.now() - 1_000) } }); }
      const failed = await prisma.video.findUniqueOrThrow({ where: { id: broken.ids.video } });
      expect(failed).toMatchObject({ status: 'DELETE_FAILED', deletionAttempts: 6, deletionErrorCode: 'STORAGE_DELETE_FAILED' });
      const retry = await app.inject({ method: 'DELETE', url: `/v1/videos/${broken.ids.video}`, headers: { 'if-match': `"${failed.version}"`, 'idempotency-key': randomUUID() } });
      expect(retry.statusCode).toBe(202);
      await tickUntilIdle(runner);
      expect(await prisma.video.findUnique({ where: { id: broken.ids.video } })).toBeNull();
    });
  });
});
