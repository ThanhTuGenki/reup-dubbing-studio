import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient, PipelineJobStatus } from '@prisma/client';
import { Observable } from 'rxjs';
import { uuidV7 } from '../../../platform/ids/uuid-v7';
import type { QueueAttemptView, QueueFilters, QueueJobDetail, QueueJobView, QueueTaskView } from '../domain/queue';
import { QueueError } from '../domain/queue-errors';

const OWNER_ID = '01994429-ec00-7000-8000-000000000002';
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ACTIVE = ['QUEUED', 'RUNNING', 'WAITING_FOR_GPU', 'WAITING_FOR_REVIEW'] as const;
const RETRYABLE_FAILURE_CODES = new Set(['DOWNLOAD_TIMEOUT', 'RENDER_OOM', 'PROVIDER_TIMEOUT', 'WORKER_LOST', 'LEASE_EXPIRED', 'TRANSIENT_STORAGE_ERROR', 'TRANSIENT_NETWORK_ERROR']);
const include = { video: { include: { channelProfile: true, seriesProfile: true } }, tasks: { orderBy: { createdAt: 'asc' as const } }, workflowEvents: { orderBy: [{ occurredAt: 'desc' as const }, { id: 'desc' as const }], take: 50 } };
type JobRow = Prisma.PipelineJobGetPayload<{ include: typeof include }>;

export class PrismaQueueRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async list(filters: QueueFilters) {
    const limit = Math.min(filters.limit ?? 50, 100); const cursor = decodeCursor(filters.cursor);
    const statuses = list(filters.status); const kinds = list(filters.kind); const resources = list(filters.resourceClass);
    const rows = await this.prisma.pipelineJob.findMany({ where: {
      ...(statuses.length ? { status: { in: statuses as PipelineJobStatus[] } } : {}),
      ...(kinds.length ? { kind: { in: kinds as never[] } } : {}),
      ...(filters.channelProfileId ? { video: { channelProfileId: filters.channelProfileId } } : {}),
      ...(filters.query ? { video: { ...(filters.channelProfileId ? { channelProfileId: filters.channelProfileId } : {}), OR: [{ displayTitle: { contains: filters.query, mode: 'insensitive' } }, { sourceContent: { externalId: { contains: filters.query, mode: 'insensitive' } } }] } } : {}),
      ...(resources.length ? { tasks: { some: { resourceClass: { in: resources as never[] } } } } : {}),
      ...((filters.createdFrom || filters.createdTo) ? { createdAt: { ...(filters.createdFrom ? { gte: new Date(filters.createdFrom) } : {}), ...(filters.createdTo ? { lte: new Date(filters.createdTo) } : {}) } } : {}),
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
    }, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
    const page = rows.slice(0, limit); const last = page.at(-1);
    return { items: page.map(view), nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null };
  }
  async detail(id: string): Promise<QueueJobDetail> { const row = await this.prisma.pipelineJob.findUnique({ where: { id }, include }); if (!row) missing(); return detailView(row); }
  async attempts(id: string, cursor?: string, limit = 50) {
    await this.exists(id); const decoded = decodeCursor(cursor); const size = Math.min(limit, 100);
    const rows = await this.prisma.taskAttempt.findMany({ where: { pipelineTask: { pipelineJobId: id }, ...(decoded ? { OR: [{ startedAt: { lt: decoded.createdAt } }, { startedAt: decoded.createdAt, id: { lt: decoded.id } }] } : {}) }, include: { pipelineTask: { select: { taskType: true } } }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], take: size + 1 });
    const page = rows.slice(0, size); const last = page.at(-1);
    return { items: page.map((row): QueueAttemptView => ({ id: row.id, taskId: row.pipelineTaskId, taskType: row.pipelineTask.taskType, attemptNumber: row.attemptNumber, executorKind: row.executorKind, status: row.status, startedAt: row.startedAt.toISOString(), finishedAt: iso(row.finishedAt), executionMs: row.executionMs?.toString() ?? null, errorCode: row.errorCode, errorDetail: row.errorDetailSafe })), nextCursor: rows.length > size && last ? encodeCursor(last.startedAt, last.id) : null };
  }
  events(): Observable<{ id: string; type: string; data: unknown }> {
    const connectedAt = new Date();
    return new Observable((subscriber) => {
      let cursor: { occurredAt: Date; id: string } | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let closed = false;
      const poll = async () => {
        try {
          const rows = await this.prisma.outboxMessage.findMany({
            where: {
              eventType: 'queue.invalidate',
              availableAt: { lte: new Date() },
              ...(cursor
                ? { OR: [{ occurredAt: { gt: cursor.occurredAt } }, { occurredAt: cursor.occurredAt, id: { gt: cursor.id } }] }
                : { occurredAt: { gte: connectedAt } }),
            },
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
            take: 100,
            select: { id: true, eventType: true, payloadSafe: true, occurredAt: true },
          });
          for (const row of rows) {
            if (closed) return;
            cursor = { occurredAt: row.occurredAt, id: row.id };
            subscriber.next({ id: row.id, type: row.eventType, data: row.payloadSafe });
          }
          if (!closed) timer = setTimeout(poll, rows.length === 100 ? 0 : 1_000);
        } catch (error) {
          subscriber.error(error);
        }
      };
      void poll();
      return () => { closed = true; if (timer) clearTimeout(timer); };
    });
  }
  cancel(id: string, version: number, key: string, requestHash: string, reason: string | null, requestId?: string) {
    return this.mutate('QUEUE_CANCEL_JOB_V1', key, requestHash, async (tx) => {
      const job = await tx.pipelineJob.findUnique({ where: { id }, include }); if (!job) missing(); if (job.version !== version) conflict();
      if (job.status !== 'CANCELLED' && !ACTIVE.includes(job.status as typeof ACTIVE[number])) throw new QueueError('JOB_NOT_CANCELLABLE', 'Job cannot be cancelled from its current status');
      if (job.status !== 'CANCELLED') { const now = new Date(); await tx.pipelineTask.updateMany({ where: { pipelineJobId: id, status: { notIn: ['SUCCEEDED', 'CANCELLED'] } }, data: { status: 'CANCELLED', version: { increment: 1 } } }); await tx.taskLease.updateMany({ where: { pipelineTask: { pipelineJobId: id }, releasedAt: null }, data: { releasedAt: now, releaseReason: 'JOB_CANCELLED' } }); await tx.taskAttempt.updateMany({ where: { pipelineTask: { pipelineJobId: id }, status: 'STARTED' }, data: { status: 'CANCELLED', finishedAt: now } }); await tx.pipelineJob.update({ where: { id }, data: { status: 'CANCELLED', finishedAt: now, version: { increment: 1 } } }); await this.recordEvent(tx, job, 'JOB_CANCELLED', 'CANCELLED', reason, requestId); }
      return detailView((await tx.pipelineJob.findUnique({ where: { id }, include }))!);
    });
  }
  retry(id: string, version: number, key: string, requestHash: string, taskId?: string, reason?: string | null, requestId?: string) {
    return this.mutate('QUEUE_RETRY_JOB_V1', key, requestHash, async (tx) => {
      const job = await tx.pipelineJob.findUnique({ where: { id }, include }); if (!job) missing(); if (job.version !== version) conflict(); if (job.status !== 'FAILED' || !isRetryable(job.failureCode)) throw new QueueError('JOB_NOT_RETRYABLE', 'The job failure is not retryable');
      const failed = taskId ? job.tasks.find((task) => task.id === taskId && task.status === 'FAILED') : [...job.tasks].reverse().find((task) => task.status === 'FAILED'); if (!failed) throw new QueueError('JOB_NOT_RETRYABLE', 'No failed task is available to retry');
      if (job.tasks.some((task) => task.createdAt > failed.createdAt && ['SUCCEEDED', 'RUNNING', 'LEASED'].includes(task.status))) throw new QueueError('JOB_RETRY_CONFLICT', 'A successor task has already produced state');
      await tx.pipelineTask.update({ where: { id: failed.id }, data: { status: 'READY', readyAt: new Date(), progressBps: 0, progressDetailSafe: null, maxAttempts: Math.max(failed.maxAttempts, failed.attemptCount + 1), version: { increment: 1 } } }); await tx.pipelineJob.update({ where: { id }, data: { status: 'QUEUED', finishedAt: null, failureCode: null, failureDetailSafe: null, version: { increment: 1 } } }); await this.recordEvent(tx, job, 'JOB_RETRIED', 'QUEUED', reason ?? null, requestId, failed.id); return detailView((await tx.pipelineJob.findUnique({ where: { id }, include }))!);
    });
  }
  private async mutate(scope: string, key: string, requestHash: string, action: (tx: Prisma.TransactionClient) => Promise<QueueJobDetail>) { const keyHash = createHash('sha256').update(key).digest('hex'); return this.prisma.$transaction(async (tx) => { const old = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key: keyHash } } }); if (old) { if (old.requestHash !== requestHash) throw new QueueError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used with another request'); return old.responseBody as unknown as QueueJobDetail; } const result = await action(tx); await tx.idempotencyRecord.create({ data: { id: uuidV7(), scope, key: keyHash, requestHash, responseBody: result as unknown as Prisma.InputJsonValue, responseEtag: `"${result.version}"` } }); return result; }, { isolationLevel: 'Serializable' }); }
  private async recordEvent(tx: Prisma.TransactionClient, job: JobRow, eventType: string, toStatus: string, message: string | null, requestId?: string, taskId?: string) { const eventId = uuidV7(); await tx.workflowEvent.create({ data: { id: eventId, videoId: job.videoId, pipelineJobId: job.id, pipelineTaskId: taskId ?? null, eventType, fromStatus: job.status, toStatus, actorType: 'USER', actorId: OWNER_ID, messageSafe: message, payloadSafe: {} } }); await tx.auditEvent.create({ data: { id: uuidV7(), actorType: 'USER', actorId: OWNER_ID, action: eventType, entityType: 'PIPELINE_JOB', entityId: job.id, requestId: requestId ?? null, beforeSafe: { status: job.status, version: job.version }, afterSafe: { status: toStatus, version: job.version + 1 }, metadataSafe: { reason: message, taskId: taskId ?? null } } }); await tx.outboxMessage.create({ data: { id: uuidV7(), aggregateType: 'PIPELINE_JOB', aggregateId: job.id, eventType: 'queue.invalidate', payloadSafe: { entity: 'JOB', jobId: job.id, jobVersion: job.version + 1, reason: eventType } } }); }
  private async exists(id: string) { if (!await this.prisma.pipelineJob.findUnique({ where: { id }, select: { id: true } })) missing(); }
}
function taskView(task: JobRow['tasks'][number]): QueueTaskView { return { id: task.id, taskType: task.taskType, resourceClass: task.resourceClass, status: task.status, progressPercent: Math.round(task.progressBps / 100), progressDetail: task.progressDetailSafe, attemptCount: task.attemptCount, maxAttempts: task.maxAttempts, readyAt: iso(task.readyAt), version: task.version, createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString() }; }
function view(row: JobRow): QueueJobView { const tasks = row.tasks; const completed = tasks.filter((task) => task.status === 'SUCCEEDED').length; const current = tasks.find((task) => !['SUCCEEDED', 'CANCELLED'].includes(task.status)) ?? tasks.at(-1) ?? null; return { id: row.id, videoId: row.videoId, kind: row.kind, status: row.status, version: row.version, title: row.video.displayTitle, channelProfileId: row.video.channelProfileId, channelProfileName: row.video.channelProfile.name, seriesProfileId: row.video.seriesProfileId, seriesProfileName: row.video.seriesProfile?.name ?? null, currentTask: current ? taskView(current) : null, progress: { percent: tasks.length ? Math.round(tasks.reduce((sum, task) => sum + (task.status === 'SUCCEEDED' ? 10000 : task.progressBps), 0) / tasks.length / 100) : 0, completedTasks: completed, totalTasks: tasks.length }, failure: row.failureCode ? { code: row.failureCode, detail: row.failureDetailSafe } : null, actions: { canRetry: row.status === 'FAILED' && isRetryable(row.failureCode) && tasks.some((task) => task.status === 'FAILED'), canCancel: ACTIVE.includes(row.status as typeof ACTIVE[number]) }, startedAt: iso(row.startedAt), finishedAt: iso(row.finishedAt), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
function detailView(row: JobRow): QueueJobDetail { return { ...view(row), tasks: row.tasks.map(taskView), timeline: row.workflowEvents.map((event) => ({ id: event.id, eventType: event.eventType, fromStatus: event.fromStatus, toStatus: event.toStatus, message: event.messageSafe, occurredAt: event.occurredAt.toISOString() })) }; }
function iso(value: Date | null) { return value?.toISOString() ?? null; }
function list(value?: string) { return value?.split(',').map((item) => item.trim()).filter(Boolean) ?? []; }
function encodeCursor(createdAt: Date, id: string) { return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString('base64url'); }
function decodeCursor(value?: string): { createdAt: Date; id: string } | null { if (!value) return null; try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString()) as { createdAt: string; id: string }; const createdAt = new Date(parsed.createdAt); if (!UUID_V7.test(parsed.id) || Number.isNaN(createdAt.valueOf())) throw new Error(); return { createdAt, id: parsed.id }; } catch { throw new QueueError('QUEUE_CURSOR_INVALID', 'Queue cursor is invalid'); } }
function missing(): never { throw new QueueError('QUEUE_JOB_NOT_FOUND', 'Queue job was not found'); }
function conflict(): never { throw new QueueError('VERSION_CONFLICT', 'Queue job version is stale'); }
function isRetryable(code: string | null) { return code !== null && RETRYABLE_FAILURE_CODES.has(code); }
