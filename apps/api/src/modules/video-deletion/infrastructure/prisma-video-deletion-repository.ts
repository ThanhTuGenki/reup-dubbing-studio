import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

import { uuidV7 } from '../../../platform/ids/uuid-v7';
import { ACTIVE_JOB_STATUSES, cancelJobInTransaction } from '../../queue';
import { DELETION_GRACE_MS, type BulkDeletionResult, type DeletionOutcome, type VideoDeletionEnvelope } from '../domain/video-deletion';
import { VideoDeletionError } from '../domain/video-deletion-errors';
import { collectVideoAssetIds, markAssetsDeleting } from './video-asset-set';

const OWNER_ID = '01994429-ec00-7000-8000-000000000002';
const SINGLE_SCOPE = 'VIDEO_DELETE_V1';
const BULK_SCOPE = 'VIDEO_BULK_DELETE_V1';
type BulkResult = { items: Array<{ videoId: string; result: BulkDeletionResult; cancelledJobIds: string[] }> };

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
