import { createHash } from 'node:crypto';
import type { LocalVideoImportResult, LocalVideoUploadRequest } from '@reup-dubbing-studio/api-contract';
import type { Prisma, PrismaClient } from '@prisma/client';

import { uuidV7 } from '../../../platform/ids/uuid-v7';
import type { PrismaProfileRepository } from '../../profiles/infrastructure/prisma-profile-repository';
import { buildFullPipelineDag } from '../application/full-pipeline-dag';
import { LocalImportError } from '../domain/local-import-errors';

const OWNER_ID = '01994429-ec00-7000-8000-000000000002';
const UPLOAD_SCOPE = 'LOCAL_VIDEO_UPLOAD_REQUEST_V1';
const COMMIT_SCOPE = 'LOCAL_VIDEO_IMPORT_COMMIT_V1';

export type PendingLocalImport = {
  id: string;
  bucket: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  checksumSha256: string;
  input: LocalVideoUploadRequest;
};

export class PrismaLocalImportRepository {
  constructor(private readonly prisma: PrismaClient, private readonly profiles: PrismaProfileRepository) {}

  async createPending(input: LocalVideoUploadRequest, bucket: string, key: string, requestHash: string): Promise<PendingLocalImport> {
    const keyHash = digest(key);
    return this.prisma.$transaction(async (tx) => {
      const prior = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope: UPLOAD_SCOPE, key: keyHash } } });
      if (prior) {
        if (prior.requestHash !== requestHash) reused();
        const body = prior.responseBody as { assetId: string };
        return pending(await tx.asset.findUnique({ where: { id: body.assetId } }));
      }
      const id = uuidV7();
      const objectKey = `local-imports/${id}/raw.mp4`;
      const asset = await tx.asset.create({ data: {
        id, storageBackend: 'R2', bucket, objectKey, fileName: input.fileName,
        status: 'PENDING', checksumSha256: input.checksumSha256, byteSize: input.byteSize,
        contentType: input.contentType, width: input.width, height: input.height,
        durationMs: input.durationMs, metadata: { localImport: input } as Prisma.InputJsonValue,
      } });
      await tx.idempotencyRecord.create({ data: {
        id: uuidV7(), scope: UPLOAD_SCOPE, key: keyHash, requestHash,
        responseBody: { assetId: id }, responseEtag: '"1"',
      } });
      return pending(asset);
    }, { isolationLevel: 'Serializable' });
  }

  async getPending(assetId: string): Promise<PendingLocalImport> {
    return pending(await this.prisma.asset.findFirst({ where: { id: assetId, status: 'PENDING' } }));
  }

  async replayCommit(key: string, requestHash: string): Promise<LocalVideoImportResult | null> {
    const prior = await this.prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope: COMMIT_SCOPE, key: digest(key) } } });
    if (!prior) return null;
    if (prior.requestHash !== requestHash) reused();
    return prior.responseBody as unknown as LocalVideoImportResult;
  }

  async commit(assetId: string, key: string, requestHash: string): Promise<LocalVideoImportResult> {
    const keyHash = digest(key);
    return this.prisma.$transaction(async (tx) => {
      const prior = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope: COMMIT_SCOPE, key: keyHash } } });
      if (prior) {
        if (prior.requestHash !== requestHash) reused();
        return prior.responseBody as unknown as LocalVideoImportResult;
      }
      const asset = await tx.asset.findFirst({ where: { id: assetId, status: 'PENDING' } });
      const item = pending(asset);
      const snapshot = await this.profiles.snapshotForJobInTransaction(tx, {
        channelProfileId: item.input.channelProfileId,
        ...(item.input.seriesProfileId ? { seriesProfileId: item.input.seriesProfileId } : {}),
      });
      const videoId = uuidV7();
      const jobId = uuidV7();
      const now = new Date();
      const dag = buildFullPipelineDag({
        rawAssetId: assetId, sourceLanguage: item.input.sourceLanguage,
        sourceByteSize: item.byteSize, snapshot, now,
      });
      await tx.video.create({ data: {
        id: videoId, sourceContentId: null, sourceKind: 'LOCAL_UPLOAD',
        localSourceMetadata: {
          fileName: item.fileName, durationMs: item.input.durationMs, width: item.input.width,
          height: item.input.height, checksumSha256: item.checksumSha256,
        },
        channelProfileId: item.input.channelProfileId,
        seriesProfileId: item.input.seriesProfileId ?? null,
        status: 'PROCESSING', sourceLanguage: item.input.sourceLanguage,
        targetLanguage: snapshot.pipeline.targetLanguage, displayTitle: item.input.title,
        ingestedAt: now, createdById: OWNER_ID,
      } });
      await tx.asset.update({ where: { id: assetId }, data: {
        status: 'AVAILABLE', uploadedAt: now, verifiedAt: now, version: { increment: 1 },
      } });
      await tx.videoAsset.create({ data: {
        id: uuidV7(), videoId, assetId, kind: 'RAW', revision: 1, isCurrent: true,
      } });
      await tx.pipelineJob.create({ data: {
        id: jobId, videoId, kind: 'FULL_PIPELINE', status: 'WAITING_FOR_GPU', pipelineVersion: 'full-pipeline-v1',
        profileSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        requestedOutputs: {
          output16x9Enabled: snapshot.pipeline.output16x9Enabled,
          output9x16Enabled: snapshot.pipeline.output9x16Enabled,
        },
        createdById: OWNER_ID,
      } });
      for (const task of dag.tasks) {
        await tx.pipelineTask.create({ data: { ...task, pipelineJobId: jobId } });
      }
      await tx.pipelineTaskDependency.createMany({ data: dag.dependencies });
      await tx.workflowEvent.create({ data: {
        id: uuidV7(), videoId, pipelineJobId: jobId, eventType: 'LOCAL_VIDEO_IMPORTED',
        toStatus: 'WAITING_FOR_GPU', actorType: 'USER', actorId: OWNER_ID,
        payloadSafe: { rawAssetId: assetId, taskCount: dag.tasks.length },
      } });
      await tx.outboxMessage.create({ data: {
        id: uuidV7(), aggregateType: 'PIPELINE_JOB', aggregateId: jobId,
        eventType: 'queue.invalidate', payloadSafe: { entity: 'JOB', jobId, videoId, reason: 'LOCAL_VIDEO_IMPORTED' },
      } });
      const result: LocalVideoImportResult = { videoId, jobId, rawAssetId: assetId, status: 'WAITING_FOR_GPU' };
      await tx.idempotencyRecord.create({ data: {
        id: uuidV7(), scope: COMMIT_SCOPE, key: keyHash, requestHash,
        responseBody: result as unknown as Prisma.InputJsonValue, responseEtag: '"1"',
      } });
      return result;
    }, { isolationLevel: 'Serializable' });
  }
}

function pending(asset: { id: string; bucket: string | null; objectKey: string; fileName: string; contentType: string | null; byteSize: bigint | null; checksumSha256: string | null; metadata: Prisma.JsonValue } | null): PendingLocalImport {
  if (!asset?.bucket || !asset.contentType || asset.byteSize === null || !asset.checksumSha256) missing();
  const metadata = record(asset.metadata);
  const input = metadata.localImport;
  if (!input || typeof input !== 'object' || Array.isArray(input)) missing();
  return {
    id: asset.id, bucket: asset.bucket, objectKey: asset.objectKey, fileName: asset.fileName,
    contentType: asset.contentType, byteSize: Number(asset.byteSize), checksumSha256: asset.checksumSha256,
    input: input as unknown as LocalVideoUploadRequest,
  };
}

function record(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {};
}

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function missing(): never { throw new LocalImportError('LOCAL_IMPORT_NOT_FOUND', 'Pending local video upload was not found'); }
function reused(): never { throw new LocalImportError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was used for another request'); }
