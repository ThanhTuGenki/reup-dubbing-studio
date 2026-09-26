import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApplication } from '../../src/application';
import type { AppConfig } from '../../src/platform/config/config';
import { uuidV7 } from '../../src/platform/ids/uuid-v7';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('GPU Worker Control Plane with PostgreSQL', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaClient;
  const digest = `sha256:${'a'.repeat(64)}`;
  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
    await cleanWorkerFixtures();
    const config: AppConfig = { nodeEnv: 'test', port: 3000, logLevel: 'error', corsOrigins: ['http://localhost:5173'], rateLimitMax: 100, rateLimitWindowMs: 60_000, healthRateLimitMax: 100, trustProxy: false, databaseUrl: databaseUrl!, settingsEncryptionKey: Buffer.alloc(32, 8).toString('base64') };
    app = await createApplication(config);
  });
  afterAll(async () => { await app?.close(); await cleanWorkerFixtures(); await prisma?.$disconnect(); });

  it('registers, enrolls, heartbeats and drains without persisting bearer secrets', async () => {
    const imageResponse = await app.inject({ method: 'POST', url: '/v1/worker-images', headers: { 'idempotency-key': 'worker-image-create-0001' }, payload: { role: 'BATCH_MEDIA', semanticVersion: '1.0.0', imageDigest: digest, registryRef: 'ghcr.io/example/media@sha256:aaaaaaaa', contractVersion: 1, capabilities: ['media.render.ffmpeg.v1'] } });
    expect(imageResponse.statusCode).toBe(201);
    const image = imageResponse.json().data;
    const createResponse = await app.inject({ method: 'POST', url: '/v1/workers', headers: { 'idempotency-key': 'worker-create-0001' }, payload: { displayName: 'Ezy batch 01', role: 'BATCH_MEDIA', provider: 'EzyCloudX', providerInstanceId: 'ctr-safe-01', expectedGpuModel: 'RTX 3090', expectedVramMb: 24_000, approvedImageId: image.id, hourlyRateCp: '15000.000000', paidVndPerCp: '1.25000000', billingStartedAt: new Date().toISOString() } });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json().data;
    const token = created.enrollment.token as string;
    expect(token).toMatch(/^enr_/u);
    const storedToken = await prisma.workerEnrollmentToken.findFirstOrThrow({ where: { workerId: created.worker.id } });
    expect(storedToken.tokenHash).not.toContain(token);
    expect(JSON.stringify(await prisma.idempotencyRecord.findFirstOrThrow({ where: { scope: 'WORKER_CREATE_V1' } }))).not.toContain(token);

    const identity = { sessionNonce: uuidV7(), role: 'BATCH_MEDIA', imageDigest: digest, agentVersion: '1.0.0', contractVersion: 1, capabilities: ['media.render.ffmpeg.v1'], gpuInventory: [{ model: 'RTX 3090', vramMb: 24576 }], cpuInventory: { cores: 16 }, capacity: { maxConcurrentTasks: 1, availableTaskSlots: 1, scratchFreeBytes: '1000000000', vramFreeMb: 24576 } };
    const enroll = await app.inject({ method: 'POST', url: '/worker/v1/enroll', headers: { authorization: `Bearer ${token}` }, payload: identity });
    expect(enroll.statusCode).toBe(201);
    const enrolled = enroll.json().data;
    expect(enrolled.credential).toMatch(/^wrk_/u);
    const storedCredential = await prisma.workerCredential.findFirstOrThrow({ where: { workerId: created.worker.id } });
    expect(storedCredential.credentialHash).not.toContain(enrolled.credential);

    const heartbeat = { sequence: '1', sentAt: new Date().toISOString(), capacity: identity.capacity, currentTaskCount: 0, activeLeaseIds: [], telemetry: { gpuUtilPercent: 0, temperatureC: 36 }, agentVersion: '1.0.0', contractVersion: 1 };
    const beat = await app.inject({ method: 'POST', url: `/worker/v1/sessions/${enrolled.session.id}/heartbeat`, headers: { authorization: `Bearer ${enrolled.credential}`, 'idempotency-key': 'worker-heartbeat-0001' }, payload: heartbeat });
    expect(beat.statusCode).toBe(200);
    expect(beat.json().data.acceptedSequence).toBe('1');
    await app.inject({ method: 'POST', url: `/worker/v1/sessions/${enrolled.session.id}/heartbeat`, headers: { authorization: `Bearer ${enrolled.credential}`, 'idempotency-key': 'worker-heartbeat-0001' }, payload: { ...heartbeat, sequence: '0' } });
    expect((await prisma.workerSession.findUniqueOrThrow({ where: { id: enrolled.session.id } })).lastHeartbeatSequence).toBe(1n);

    const current = (await app.inject({ method: 'GET', url: `/v1/workers/${created.worker.id}` })).json().data;
    const drain = await app.inject({ method: 'POST', url: `/v1/workers/${created.worker.id}/drain`, headers: { 'if-match': `"${current.version}"`, 'idempotency-key': 'worker-drain-0001' } });
    expect(drain.statusCode).toBe(200);
    expect(drain.json().data).toMatchObject({ desiredStatus: 'DRAINING', observedStatus: 'SAFE_TO_TERMINATE', safeToTerminate: true });
    const drained = drain.json().data;
    const terminated = await app.inject({ method: 'POST', url: `/v1/workers/${created.worker.id}/confirm-termination`, headers: { 'if-match': `"${drained.version}"`, 'idempotency-key': 'worker-terminate-0001' } });
    expect(terminated.statusCode).toBe(200);
    expect(terminated.json().data.observedStatus).toBe('TERMINATED');
    expect(await prisma.workerBillingSession.count({ where: { workerId: created.worker.id, billingEndedAt: null } })).toBe(0);
  });

  it('projects an overdue heartbeat as OFFLINE and recovers on the next valid heartbeat', async () => {
    const worker = await registeredWorker('offline');
    await prisma.workerSession.update({ where: { id: worker.sessionId }, data: { lastHeartbeatAt: new Date(Date.now() - 46_000) } });

    const offline = await app.inject({ method: 'GET', url: `/v1/workers/${worker.workerId}` });
    expect(offline.statusCode).toBe(200);
    expect(offline.json().data).toMatchObject({ observedStatus: 'OFFLINE', safeToTerminate: false });

    const recovered = await heartbeat(worker, { sequence: '1' });
    expect(recovered.statusCode).toBe(200);
    const detail = await app.inject({ method: 'GET', url: `/v1/workers/${worker.workerId}` });
    expect(detail.json().data.observedStatus).toBe('READY');
  });

  it('revokes the active credential immediately and rejects later heartbeats', async () => {
    const worker = await registeredWorker('revoke');
    const detail = (await app.inject({ method: 'GET', url: `/v1/workers/${worker.workerId}` })).json().data;
    const revoked = await app.inject({ method: 'POST', url: `/v1/workers/${worker.workerId}/revoke`, headers: { 'if-match': `"${detail.version}"`, 'idempotency-key': randomUUID() } });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().data.desiredStatus).toBe('REVOKED');
    expect(await prisma.workerCredential.count({ where: { workerId: worker.workerId, revokedAt: null } })).toBe(0);

    const rejected = await heartbeat(worker, { sequence: '1' });
    expect(rejected.statusCode).toBe(401);
    expect(rejected.json().code).toBe('WORKER_CREDENTIAL_REVOKED');
  });

  it('rejects an incompatible runtime version and records only a safe error', async () => {
    const worker = await registeredWorker('version');
    const mismatch = await heartbeat(worker, { sequence: '1', agentVersion: '2.0.0' });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().code).toBe('WORKER_VERSION_MISMATCH');

    const detail = (await app.inject({ method: 'GET', url: `/v1/workers/${worker.workerId}` })).json().data;
    expect(detail).toMatchObject({ observedStatus: 'ERROR', lastError: { code: 'WORKER_VERSION_MISMATCH', detail: 'Worker image or contract version is not approved' } });
    expect(JSON.stringify(detail)).not.toContain(worker.credential);
  });

  it('rejects stale Web mutations without changing worker state', async () => {
    const worker = await registeredWorker('stale');
    const before = (await app.inject({ method: 'GET', url: `/v1/workers/${worker.workerId}` })).json().data;
    const stale = await app.inject({ method: 'POST', url: `/v1/workers/${worker.workerId}/drain`, headers: { 'if-match': `"${before.version - 1}"`, 'idempotency-key': randomUUID() } });
    expect(stale.statusCode).toBe(412);
    expect(stale.json().code).toBe('VERSION_CONFLICT');
    const after = (await app.inject({ method: 'GET', url: `/v1/workers/${worker.workerId}` })).json().data;
    expect(after).toMatchObject({ desiredStatus: 'ACTIVE', observedStatus: 'READY', version: before.version });
  });

  it('runs a no-GPU task lifecycle and projects real task state to Queue and Studio events', async () => {
    const worker = await registeredWorker('fake-e2e');
    const { taskId, jobId } = await workerTaskFixture(false);
    expect((await heartbeat(worker, { sequence: '1' })).statusCode).toBe(200);
    const headers = { authorization: `Bearer ${worker.credential}`, 'idempotency-key': randomUUID() };
    const claim = await app.inject({ method: 'POST', url: '/worker/v1/tasks/claim', headers, payload: { sessionId: worker.sessionId, waitSeconds: 0 } });
    expect(claim.statusCode).toBe(200);
    const task = claim.json().data.task;
    const lease = { leaseId: task.leaseId, fencingToken: task.fencingToken };

    expect((await app.inject({ method: 'POST', url: `/worker/v1/tasks/${taskId}/attempts/${task.attemptId}/start`, headers: { ...headers, 'idempotency-key': randomUUID() }, payload: lease })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/worker/v1/tasks/${taskId}/attempts/${task.attemptId}/renew`, headers: { ...headers, 'idempotency-key': randomUUID() }, payload: lease })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/worker/v1/tasks/${taskId}/attempts/${task.attemptId}/progress`, headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { ...lease, progressBps: 5000, detailSafe: 'fake:5000' } })).statusCode).toBe(200);
    const completed = await app.inject({ method: 'POST', url: `/worker/v1/tasks/${taskId}/attempts/${task.attemptId}/complete`, headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { ...lease, outputs: [], result: { adapter: 'fake' }, metrics: { executionMs: 10 } } });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().data.taskStatus).toBe('SUCCEEDED');

    const queue = await app.inject({ method: 'GET', url: `/v1/queue/jobs/${jobId}` });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().data).toMatchObject({ status: 'SUCCEEDED', progress: { percent: 100 }, tasks: [{ id: taskId, status: 'SUCCEEDED', progressPercent: 100 }] });
    const events = await prisma.workflowEvent.findMany({ where: { pipelineTaskId: taskId }, orderBy: { occurredAt: 'asc' } });
    expect(events.map((event) => event.eventType)).toEqual(['TASK_LEASED', 'TASK_STARTED', 'TASK_PROGRESS_REPORTED', 'TASK_SUCCEEDED']);
    const invalidations = await prisma.outboxMessage.findMany({ where: { aggregateId: jobId, eventType: 'queue.invalidate' } });
    expect(invalidations).toHaveLength(4);
    expect(invalidations.at(-1)?.payloadSafe).toMatchObject({ videoId: expect.any(String), jobId, taskId, reason: 'TASK_SUCCEEDED' });
  });

  it('claims atomically, enforces monotonic progress and fences an expired attempt', async () => {
    const worker = await registeredWorker('task-lifecycle');
    const { taskId } = await workerTaskFixture();
    const claim = () => app.inject({ method: 'POST', url: '/worker/v1/tasks/claim', headers: { authorization: `Bearer ${worker.credential}`, 'idempotency-key': randomUUID() }, payload: { sessionId: worker.sessionId, waitSeconds: 0 } });
    const claims = await Promise.all([claim(), claim()]);
    expect(claims.map((response) => response.statusCode)).toEqual([200, 200]);
    const tasks = claims.map((response) => response.json().data.task).filter(Boolean);
    expect(tasks).toHaveLength(1);
    const first = tasks[0];
    expect(first).toMatchObject({ taskId, taskType: 'RENDER', fencingToken: '1' });
    expect(await prisma.taskAttempt.count({ where: { pipelineTaskId: taskId } })).toBe(1);

    const actionHeaders = { authorization: `Bearer ${worker.credential}`, 'idempotency-key': randomUUID() };
    const leaseBody = { leaseId: first.leaseId, fencingToken: first.fencingToken };
    const started = await app.inject({ method: 'POST', url: `/worker/v1/tasks/${taskId}/attempts/${first.attemptId}/start`, headers: actionHeaders, payload: leaseBody });
    expect(started.statusCode).toBe(200);
    expect(started.json().data.taskStatus).toBe('RUNNING');
    const progressKey = randomUUID();
    const progress = await app.inject({ method: 'POST', url: `/worker/v1/tasks/${taskId}/attempts/${first.attemptId}/progress`, headers: { ...actionHeaders, 'idempotency-key': progressKey }, payload: { ...leaseBody, progressBps: 1000, detailSafe: 'rendering' } });
    expect(progress.statusCode).toBe(200);
    const duplicate = await app.inject({ method: 'POST', url: `/worker/v1/tasks/${taskId}/attempts/${first.attemptId}/progress`, headers: { ...actionHeaders, 'idempotency-key': progressKey }, payload: { ...leaseBody, progressBps: 1000, detailSafe: 'rendering' } });
    expect(duplicate.json().data).toEqual(progress.json().data);
    const reused = await app.inject({ method: 'POST', url: `/worker/v1/tasks/${taskId}/attempts/${first.attemptId}/progress`, headers: { ...actionHeaders, 'idempotency-key': progressKey }, payload: { ...leaseBody, progressBps: 1001, detailSafe: 'rendering' } });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
    const regression = await app.inject({ method: 'POST', url: `/worker/v1/tasks/${taskId}/attempts/${first.attemptId}/progress`, headers: { ...actionHeaders, 'idempotency-key': randomUUID() }, payload: { ...leaseBody, progressBps: 999 } });
    expect(regression.statusCode).toBe(409);
    expect(regression.json().code).toBe('TASK_PROGRESS_REGRESSION');

    await prisma.taskLease.update({ where: { id: first.leaseId }, data: { leasedAt: new Date(Date.now() - 61_000), renewedAt: new Date(Date.now() - 61_000), expiresAt: new Date(Date.now() - 1_000) } });
    await claim();
    const timedOut = await prisma.taskAttempt.findUniqueOrThrow({ where: { id: first.attemptId } });
    expect(timedOut.status).toBe('TIMED_OUT');
    const restarted = await app.inject({ method: 'POST', url: '/worker/v1/sessions', headers: { authorization: `Bearer ${worker.credential}`, 'idempotency-key': randomUUID() }, payload: { ...worker.identity, sessionNonce: uuidV7() } });
    expect(restarted.statusCode).toBe(201);
    const oldSession = worker.sessionId;
    worker.sessionId = restarted.json().data.session.id;
    expect((await prisma.workerSession.findUniqueOrThrow({ where: { id: oldSession } })).endReason).toBe('REPLACED');
    await prisma.pipelineTask.update({ where: { id: taskId }, data: { readyAt: new Date(Date.now() - 1_000) } });
    const second = (await claim()).json().data.task;
    expect(second.fencingToken).toBe('2');
    const secondStarted = await app.inject({ method: 'POST', url: `/worker/v1/tasks/${taskId}/attempts/${second.attemptId}/start`, headers: { ...actionHeaders, 'idempotency-key': randomUUID() }, payload: { leaseId: second.leaseId, fencingToken: second.fencingToken } });
    expect(secondStarted.statusCode).toBe(200);
    const stale = await app.inject({ method: 'POST', url: `/worker/v1/tasks/${taskId}/attempts/${first.attemptId}/renew`, headers: { ...actionHeaders, 'idempotency-key': randomUUID() }, payload: leaseBody });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('STALE_TASK_ATTEMPT');
    const lateCompletion = await app.inject({ method: 'POST', url: `/worker/v1/tasks/${taskId}/attempts/${first.attemptId}/complete`, headers: { ...actionHeaders, 'idempotency-key': randomUUID() }, payload: { ...leaseBody, outputs: [], result: {}, metrics: {} } });
    expect(lateCompletion.statusCode).toBe(409);
    expect(lateCompletion.json().code).toBe('STALE_TASK_ATTEMPT');
    const detail = (await app.inject({ method: 'GET', url: `/v1/workers/${worker.workerId}` })).json().data;
    const drain = await app.inject({ method: 'POST', url: `/v1/workers/${worker.workerId}/drain`, headers: { 'if-match': `"${detail.version}"`, 'idempotency-key': randomUUID() } });
    expect(drain.statusCode).toBe(200);
    const blockedClaim = await claim();
    expect(blockedClaim.statusCode).toBe(409);
    expect(blockedClaim.json().code).toBe('WORKER_DRAINING');
    const missingOutput = await app.inject({ method: 'POST', url: `/worker/v1/tasks/${taskId}/attempts/${second.attemptId}/complete`, headers: { ...actionHeaders, 'idempotency-key': randomUUID() }, payload: { leaseId: second.leaseId, fencingToken: second.fencingToken, outputs: [], result: {}, metrics: {} } });
    expect(missingOutput.statusCode).toBe(409);
    expect(missingOutput.json().code).toBe('TASK_OUTPUT_INVALID');
    await prisma.$transaction([
      prisma.pipelineTask.update({ where: { id: taskId }, data: { status: 'CANCELLED' } }),
      prisma.taskLease.update({ where: { id: second.leaseId }, data: { releasedAt: new Date(), releaseReason: 'CANCELLED' } }),
      prisma.taskAttempt.update({ where: { id: second.attemptId }, data: { status: 'CANCELLED', finishedAt: new Date() } }),
    ]);
    const cancelSignal = await heartbeat(worker, { sequence: '2', currentTaskCount: 1, activeLeaseIds: [second.leaseId] });
    expect(cancelSignal.statusCode).toBe(200);
    expect(cancelSignal.json().data.cancelLeaseIds).toContain(second.leaseId);
    const safe = await app.inject({ method: 'GET', url: `/v1/workers/${worker.workerId}` });
    expect(safe.json().data).toMatchObject({ desiredStatus: 'DRAINING', observedStatus: 'SAFE_TO_TERMINATE', safeToTerminate: true });

    const offline = await registeredWorker('task-offline');
    await prisma.workerSession.update({ where: { id: offline.sessionId }, data: { lastHeartbeatAt: new Date(Date.now() - 46_000) } });
    const offlineClaim = await app.inject({ method: 'POST', url: '/worker/v1/tasks/claim', headers: { authorization: `Bearer ${offline.credential}`, 'idempotency-key': randomUUID() }, payload: { sessionId: offline.sessionId, waitSeconds: 0 } });
    expect(offlineClaim.statusCode).toBe(409);
    expect(offlineClaim.json().code).toBe('WORKER_NOT_ACTIVE');
  });

  async function registeredWorker(label: string) {
    const imageDigest = `sha256:${randomBytes(32).toString('hex')}`;
    const imageResponse = await app.inject({ method: 'POST', url: '/v1/worker-images', headers: { 'idempotency-key': randomUUID() }, payload: { role: 'BATCH_MEDIA', semanticVersion: '1.0.0', imageDigest, registryRef: `ghcr.io/example/${label}@${imageDigest}`, contractVersion: 1, capabilities: ['media.render.ffmpeg.v1'] } });
    expect(imageResponse.statusCode).toBe(201);
    const image = imageResponse.json().data;
    const createResponse = await app.inject({ method: 'POST', url: '/v1/workers', headers: { 'idempotency-key': randomUUID() }, payload: { displayName: `Worker ${label}`, role: 'BATCH_MEDIA', provider: 'EzyCloudX', providerInstanceId: `ctr-${label}`, approvedImageId: image.id, hourlyRateCp: '1000', billingStartedAt: new Date().toISOString() } });
    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json().data;
    const identity = { sessionNonce: uuidV7(), role: 'BATCH_MEDIA', imageDigest, agentVersion: '1.0.0', contractVersion: 1, capabilities: ['media.render.ffmpeg.v1'], gpuInventory: [{ model: 'RTX 3090', vramMb: 24576 }], cpuInventory: { cores: 16 }, capacity: { maxConcurrentTasks: 1, availableTaskSlots: 1, scratchFreeBytes: '1000000000', vramFreeMb: 24576 } };
    const enroll = await app.inject({ method: 'POST', url: '/worker/v1/enroll', headers: { authorization: `Bearer ${created.enrollment.token}` }, payload: identity });
    expect(enroll.statusCode).toBe(201);
    return { workerId: created.worker.id as string, sessionId: enroll.json().data.session.id as string, credential: enroll.json().data.credential as string, identity };
  }

  function heartbeat(worker: Awaited<ReturnType<typeof registeredWorker>>, overrides: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: `/worker/v1/sessions/${worker.sessionId}/heartbeat`, headers: { authorization: `Bearer ${worker.credential}`, 'idempotency-key': randomUUID() }, payload: { sequence: '1', sentAt: new Date().toISOString(), capacity: worker.identity.capacity, currentTaskCount: 0, activeLeaseIds: [], telemetry: { gpuUtilPercent: 0 }, agentVersion: worker.identity.agentVersion, contractVersion: worker.identity.contractVersion, ...overrides } });
  }

  async function workerTaskFixture(requiresOutput = true) {
    const userId = uuidV7(); const channelId = uuidV7(); const sourceId = uuidV7(); const videoId = uuidV7(); const jobId = uuidV7(); const taskId = uuidV7();
    await prisma.user.create({ data: { id: userId, displayName: 'Worker task test' } });
    await prisma.channelProfile.create({ data: { id: channelId, name: 'Worker task channel', normalizedName: `worker-task-${channelId}`, status: 'ACTIVE', targetLanguage: 'vi', subtitleLanguage: 'vi', subtitleFilenameRule: '{slug}.srt' } });
    const now = new Date();
    await prisma.sourceContent.create({ data: { id: sourceId, platform: 'DOUYIN', externalId: `worker-task-${sourceId}`, contentType: 'VIDEO', title: 'Worker task video', durationMs: 1_000, availability: 'AVAILABLE', firstSeenAt: now, lastSeenAt: now } });
    await prisma.video.create({ data: { id: videoId, sourceContentId: sourceId, channelProfileId: channelId, status: 'PROCESSING', sourceLanguage: 'zh', targetLanguage: 'vi', createdById: userId } });
    const outputs = requiresOutput ? [{ slot: 'video-16x9', kind: 'OUTPUT_VIDEO', minItems: 1, maxItems: 1, allowedContentTypes: ['video/mp4'], maxByteSize: '1000000000' }] : [];
    await prisma.pipelineJob.create({ data: { id: jobId, videoId, kind: 'RERENDER', status: 'WAITING_FOR_GPU', pipelineVersion: 'worker-task-test', profileSnapshot: {}, requestedOutputs: {}, tasks: { create: { id: taskId, taskType: 'RENDER', resourceClass: 'GPU_BATCH', status: 'READY', readyAt: now, inputManifest: { inputs: [], outputs }, configuration: { kind: 'RENDER', subtitleMode: 'EXTERNAL_ONLY', variants: requiresOutput ? [{ variant: 'FULL_16X9', outputSlot: 'video-16x9' }] : [] }, requiredCapabilities: ['media.render.ffmpeg.v1'], minimumVramMb: 1, minimumScratchBytes: 1 } } } });
    return { taskId, jobId };
  }

  async function cleanWorkerFixtures() {
    const jobs = await prisma.pipelineJob.findMany({ where: { pipelineVersion: 'worker-task-test' }, select: { id: true, videoId: true, video: { select: { sourceContentId: true, channelProfileId: true, createdById: true } } } });
    const jobIds = jobs.map((row) => row.id); const videoIds = jobs.map((row) => row.videoId);
    await prisma.outboxMessage.deleteMany({ where: { aggregateId: { in: jobIds } } });
    await prisma.workflowEvent.deleteMany({ where: { pipelineJobId: { in: jobIds } } });
    await prisma.taskLease.deleteMany({ where: { pipelineTask: { pipelineJobId: { in: jobIds } } } });
    await prisma.taskAttempt.deleteMany({ where: { pipelineTask: { pipelineJobId: { in: jobIds } } } });
    await prisma.pipelineTask.deleteMany({ where: { pipelineJobId: { in: jobIds } } });
    await prisma.pipelineJob.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.video.deleteMany({ where: { id: { in: videoIds } } });
    await prisma.sourceContent.deleteMany({ where: { id: { in: jobs.map((row) => row.video.sourceContentId).filter((id): id is string => id !== null) } } });
    await prisma.channelProfile.deleteMany({ where: { id: { in: jobs.map((row) => row.video.channelProfileId) } } });
    await prisma.user.deleteMany({ where: { id: { in: jobs.map((row) => row.video.createdById) } } });
    await prisma.workerSession.deleteMany();
    await prisma.workerCredential.deleteMany();
    await prisma.workerEnrollmentToken.deleteMany();
    await prisma.workerBillingSession.deleteMany();
    await prisma.worker.deleteMany();
    await prisma.approvedWorkerImage.deleteMany();
    await prisma.idempotencyRecord.deleteMany({ where: { scope: { startsWith: 'WORKER_' } } });
  }
});
