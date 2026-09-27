import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

import { uuidV7 } from '../../../platform/ids/uuid-v7';
import { ACTIVE_JOB_STATUSES, cancelJobInTransaction } from '../../queue';
import { DELETION_GRACE_MS, DELETION_LEASE_MS, nextDeletionSchedule, type BulkDeletionResult, type DeletionOutcome, type VideoDeletionEnvelope } from '../domain/video-deletion';
import { VideoDeletionError } from '../domain/video-deletion-errors';
import { collectVideoAssetIds, markAssetsDeleting } from './video-asset-set';

const OWNER_ID = '01994429-ec00-7000-8000-000000000002';
const SINGLE_SCOPE = 'VIDEO_DELETE_V1';
const BULK_SCOPE = 'VIDEO_BULK_DELETE_V1';
type BulkResult = { items: Array<{ videoId: string; result: BulkDeletionResult; cancelledJobIds: string[] }> };
export type PurgeAsset = { id: string; storageBackend: string; bucket: string | null; objectKey: string; previousStatus: string };

export class PrismaVideoDeletionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  request(videoId: string, version: number, key: string, requestHash: string, requestId?: string): Promise<VideoDeletionEnvelope> {
    return this.prisma.$transaction(async (tx) => {
      const prior = await replay<VideoDeletionEnvelope>(tx, SINGLE_SCOPE, key, requestHash);
      if (prior) return prior;
      const outcome = await requestInTransaction(tx, videoId, version, requestId);
      if (outcome.result === 'NOT_FOUND') throw new VideoDeletionError('VIDEO_NOT_FOUND', 'Video was not found');
      if (outcome.result === 'VERSION_CONFLICT') throw new VideoDeletionError('VIDEO_VERSION_CONFLICT', 'Video version is stale');
      if (outcome.result === 'HAS_PUBLICATION_HISTORY') throw new VideoDeletionError('VIDEO_HAS_PUBLICATION_HISTORY', 'Video has publication proof and cannot be deleted');
      await remember(tx, SINGLE_SCOPE, key, requestHash, outcome.envelope!);
      return outcome.envelope!;
    }, { isolationLevel: 'Serializable' });
  }

  /** Each item runs in its own transaction so one bad item never rolls back the others. */
  async requestMany(items: Array<{ videoId: string; version: number }>, key: string, requestHash: string, requestId?: string): Promise<BulkResult> {
    const prior = await replay<BulkResult>(this.prisma, BULK_SCOPE, key, requestHash);
    if (prior) return prior;
    const results: BulkResult['items'] = [];
    for (const item of items) {
      const outcome = await this.prisma.$transaction((tx) => requestInTransaction(tx, item.videoId, item.version, requestId), { isolationLevel: 'Serializable' });
      results.push({ videoId: item.videoId, result: outcome.result, cancelledJobIds: outcome.envelope?.cancelledJobIds ?? [] });
    }
    const result = { items: results };
    try { await remember(this.prisma, BULK_SCOPE, key, requestHash, result); } catch (error) { const raced = await replay<BulkResult>(this.prisma, BULK_SCOPE, key, requestHash); if (!raced) throw error; return raced; }
    return result;
  }

  /** Claims one due DELETING video and pushes its next attempt out by the soft lease. */
  async claimNext(now: Date): Promise<{ id: string; attempts: number; graceUntil: Date | null } | null> {
    const lease = new Date(now.getTime() + DELETION_LEASE_MS);
    const rows = await this.prisma.$queryRaw<Array<{ id: string; attempts: number; graceUntil: Date | null }>>`
      UPDATE "videos" SET "deletion_next_attempt_at" = ${lease}
      WHERE "id" = (SELECT "id" FROM "videos" WHERE "status" = 'DELETING' AND "deletion_next_attempt_at" <= ${now} ORDER BY "deletion_requested_at" ASC, "id" ASC LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING "id", "deletion_attempts" AS "attempts", "deletion_grace_until" AS "graceUntil"`;
    return rows[0] ?? null;
  }

  async assetsToPurge(videoId: string): Promise<PurgeAsset[]> {
    const ids = await this.prisma.$transaction((tx) => collectVideoAssetIds(tx, videoId));
    const rows = await this.prisma.asset.findMany({ where: { id: { in: ids }, status: 'DELETING' }, select: { id: true, storageBackend: true, bucket: true, objectKey: true, metadata: true }, orderBy: { id: 'asc' } });
    return rows.map((row) => ({ id: row.id, storageBackend: row.storageBackend, bucket: row.bucket, objectKey: row.objectKey, previousStatus: previousStatus(row.metadata) }));
  }

  async markAssetDeleted(assetId: string) { await this.prisma.asset.updateMany({ where: { id: assetId, status: 'DELETING' }, data: { status: 'DELETED', deletedAt: new Date(), version: { increment: 1 } } }); }

  async scheduleAt(videoId: string, at: Date) { await this.prisma.video.updateMany({ where: { id: videoId, status: 'DELETING' }, data: { deletionNextAttemptAt: at } }); }

  async recordFailure(videoId: string, attemptsBefore: number, code: string, now: Date) {
    const attempts = attemptsBefore + 1; const schedule = nextDeletionSchedule(attempts, now);
    await this.prisma.video.updateMany({ where: { id: videoId, status: 'DELETING' }, data: { deletionAttempts: attempts, deletionErrorCode: code, deletionNextAttemptAt: schedule.nextAttemptAt, status: schedule.status, ...(schedule.status === 'DELETE_FAILED' ? { version: { increment: 1 } } : {}) } });
  }

  /** Removes the rows once every owned object is gone; reschedules if new jobs or files appeared meanwhile. */
  finalize(videoId: string, now: Date): Promise<'DELETED' | 'RESCHEDULED' | 'SKIPPED'> {
    return this.prisma.$transaction(async (tx) => {
      const video = await tx.video.findUnique({ where: { id: videoId }, select: { status: true, displayTitle: true } });
      if (video?.status !== 'DELETING') return 'SKIPPED';
      const active = await tx.pipelineJob.findMany({ where: { videoId, status: { in: [...ACTIVE_JOB_STATUSES] } }, select: { id: true } });
      for (const job of active) await cancelJobInTransaction(tx, job.id, 'VIDEO_DELETED');
      const assetIds = await collectVideoAssetIds(tx, videoId);
      const stragglers = await tx.asset.findMany({ where: { id: { in: assetIds }, status: { not: 'DELETED' } }, select: { id: true, status: true } });
      if (active.length || stragglers.length) {
        await markAssetsDeleting(tx, stragglers.map((row) => row.id));
        const grace = active.length || stragglers.some((row) => row.status === 'PENDING') ? new Date(now.getTime() + DELETION_GRACE_MS) : now;
        await tx.video.update({ where: { id: videoId }, data: { deletionGraceUntil: grace, deletionNextAttemptAt: now } });
        return 'RESCHEDULED';
      }
      if (await tx.publicationProof.count({ where: { task: { publishPackage: { videoId } } } })) throw new VideoDeletionError('VIDEO_HAS_PUBLICATION_HISTORY', 'Video gained publication proof');
      const stats = await tx.asset.aggregate({ where: { id: { in: assetIds } }, _count: { _all: true }, _sum: { byteSize: true } });
      await deleteVideoRows(tx, videoId, assetIds);
      await tx.auditEvent.create({ data: { id: uuidV7(), actorType: 'SYSTEM', action: 'VIDEO_DELETED', entityType: 'VIDEO', entityId: videoId, metadataSafe: { title: video.displayTitle, objectCount: stats._count._all, byteSize: (stats._sum.byteSize ?? 0n).toString() } } });
      return 'DELETED';
    }, { isolationLevel: 'Serializable', timeout: 30_000 });
  }
}

async function requestInTransaction(tx: Prisma.TransactionClient, videoId: string, version: number, requestId?: string): Promise<DeletionOutcome> {
  const video = await tx.video.findUnique({ where: { id: videoId }, select: { id: true, status: true, version: true, displayTitle: true, sourceKind: true } });
  if (!video) return { result: 'NOT_FOUND', envelope: null };
  if (video.status === 'DELETING') return { result: 'ALREADY_DELETING', envelope: { videoId, status: 'DELETING', cancelledJobIds: [] } };
  if (video.version !== version) return { result: 'VERSION_CONFLICT', envelope: null };
  if (await tx.publicationProof.count({ where: { task: { publishPackage: { videoId } } } })) return { result: 'HAS_PUBLICATION_HISTORY', envelope: null };
  const jobs = await tx.pipelineJob.findMany({ where: { videoId, status: { in: [...ACTIVE_JOB_STATUSES] } }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  const cancelledJobIds: string[] = [];
  for (const job of jobs) if (await cancelJobInTransaction(tx, job.id, 'VIDEO_DELETED', requestId)) cancelledJobIds.push(job.id);
  const assetIds = await collectVideoAssetIds(tx, videoId);
  const { pending } = await markAssetsDeleting(tx, assetIds);
  const now = new Date();
  const graceUntil = pending > 0 || cancelledJobIds.length > 0 ? new Date(now.getTime() + DELETION_GRACE_MS) : now;
  await tx.video.update({ where: { id: videoId }, data: { status: 'DELETING', deletionRequestedAt: now, deletionNextAttemptAt: now, deletionGraceUntil: graceUntil, deletionAttempts: 0, deletionErrorCode: null, version: { increment: 1 } } });
  await tx.auditEvent.create({ data: { id: uuidV7(), actorType: 'USER', actorId: OWNER_ID, action: 'VIDEO_DELETION_REQUESTED', entityType: 'VIDEO', entityId: videoId, requestId: requestId ?? null, beforeSafe: { status: video.status, version: video.version }, afterSafe: { status: 'DELETING', version: video.version + 1 }, metadataSafe: { title: video.displayTitle, sourceKind: video.sourceKind, assetCount: assetIds.length, cancelledJobIds } } });
  return { result: 'ACCEPTED', envelope: { videoId, status: 'DELETING', cancelledJobIds } };
}

type IdempotencyStore = Pick<Prisma.TransactionClient, 'idempotencyRecord'>;
async function replay<T>(db: IdempotencyStore, scope: string, key: string, requestHash: string): Promise<T | null> {
  const old = await db.idempotencyRecord.findUnique({ where: { scope_key: { scope, key: digest(key) } } });
  if (!old) return null;
  if (old.requestHash !== requestHash) throw new VideoDeletionError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used with another request');
  return old.responseBody as unknown as T;
}
async function remember(db: IdempotencyStore, scope: string, key: string, requestHash: string, body: unknown) {
  await db.idempotencyRecord.create({ data: { id: uuidV7(), scope, key: digest(key), requestHash, responseBody: body as Prisma.InputJsonValue, responseEtag: '"1"' } });
}
function digest(value: string) { return createHash('sha256').update(value).digest('hex'); }

/** Deletes the video tree in foreign-key order (all FKs are RESTRICT). */
async function deleteVideoRows(tx: Prisma.TransactionClient, videoId: string, assetIds: string[]) {
  const jobIds = (await tx.pipelineJob.findMany({ where: { videoId }, select: { id: true } })).map((row) => row.id);
  const taskIds = (await tx.pipelineTask.findMany({ where: { pipelineJobId: { in: jobIds } }, select: { id: true } })).map((row) => row.id);
  const attemptIds = (await tx.taskAttempt.findMany({ where: { pipelineTaskId: { in: taskIds } }, select: { id: true } })).map((row) => row.id);
  const segmentIds = (await tx.videoSegment.findMany({ where: { videoId }, select: { id: true } })).map((row) => row.id);
  const runIds = (await tx.transcriptRun.findMany({ where: { videoId }, select: { id: true } })).map((row) => row.id);
  const packageIds = (await tx.publishPackage.findMany({ where: { videoId }, select: { id: true } })).map((row) => row.id);
  const publicationTaskIds = (await tx.publicationTask.findMany({ where: { publishPackageId: { in: packageIds } }, select: { id: true } })).map((row) => row.id);
  const fieldIds = (await tx.publicationField.findMany({ where: { publicationTaskId: { in: publicationTaskIds } }, select: { id: true } })).map((row) => row.id);
  await tx.publicationField.updateMany({ where: { id: { in: fieldIds } }, data: { currentRevisionId: null } });
  await tx.publicationFieldRevision.deleteMany({ where: { publicationFieldId: { in: fieldIds } } });
  await tx.publicationField.deleteMany({ where: { id: { in: fieldIds } } });
  await tx.publicationChecklistItem.deleteMany({ where: { publicationTaskId: { in: publicationTaskIds } } });
  await tx.publicationTask.deleteMany({ where: { id: { in: publicationTaskIds } } });
  await tx.publishPackage.deleteMany({ where: { id: { in: packageIds } } });
  await tx.renderOutput.deleteMany({ where: { videoId } });
  await tx.reviewDecision.deleteMany({ where: { videoId } });
  await tx.segmentAudioRevision.deleteMany({ where: { videoSegmentId: { in: segmentIds } } });
  await tx.videoSegment.updateMany({ where: { videoId }, data: { currentRevisionId: null } });
  await tx.segmentRevision.deleteMany({ where: { videoSegmentId: { in: segmentIds } } });
  await tx.videoSegment.deleteMany({ where: { videoId } });
  await tx.transcriptSegment.deleteMany({ where: { transcriptRunId: { in: runIds } } });
  await tx.transcriptRun.deleteMany({ where: { videoId } });
  await tx.videoAsset.deleteMany({ where: { videoId } });
  await tx.workflowEvent.deleteMany({ where: { OR: [{ videoId }, { pipelineJobId: { in: jobIds } }, { pipelineTaskId: { in: taskIds } }, { taskAttemptId: { in: attemptIds } }] } });
  await tx.taskLease.deleteMany({ where: { pipelineTaskId: { in: taskIds } } });
  await tx.asset.updateMany({ where: { createdByAttemptId: { in: attemptIds }, id: { notIn: assetIds } }, data: { createdByAttemptId: null } });
  await tx.asset.deleteMany({ where: { id: { in: assetIds } } });
  await tx.taskAttempt.deleteMany({ where: { id: { in: attemptIds } } });
  await tx.pipelineTaskDependency.deleteMany({ where: { OR: [{ taskId: { in: taskIds } }, { dependsOnTaskId: { in: taskIds } }] } });
  await tx.pipelineTask.deleteMany({ where: { id: { in: taskIds } } });
  await tx.pipelineJob.deleteMany({ where: { id: { in: jobIds } } });
  await tx.video.delete({ where: { id: videoId } });
}
function previousStatus(metadata: Prisma.JsonValue) { const deletion = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, Prisma.JsonValue>).deletion : null; const value = deletion && typeof deletion === 'object' && !Array.isArray(deletion) ? (deletion as Record<string, Prisma.JsonValue>).previousStatus : null; return typeof value === 'string' ? value : 'AVAILABLE'; }
