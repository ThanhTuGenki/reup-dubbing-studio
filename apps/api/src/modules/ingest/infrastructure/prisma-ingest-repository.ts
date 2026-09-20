import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { uuidV7 } from '../../../platform/ids/uuid-v7';
import type { IngestRepository } from '../application/ports';
import type {
  IngestCreateItem,
  IngestCreateResult,
  IngestDisposition,
  IngestPreflight,
  IngestPreflightItem,
  IngestSelection,
} from '../domain/ingest';
import { IngestError } from '../domain/ingest-errors';
import { ProfileError } from '../../profiles/domain/profile-errors';
import type { ProfileJobSnapshot } from '../../profiles';
import type { PrismaProfileRepository } from '../../profiles/infrastructure/prisma-profile-repository';

const OWNER_ID = '01994429-ec00-7000-8000-000000000002';
const IDEMPOTENCY_SCOPE = 'INGEST_CREATE_JOBS_V1';
const ACTIVE_JOB_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_FOR_GPU', 'WAITING_FOR_REVIEW'] as const;

type Evaluation = {
  item: IngestPreflightItem;
  source: {
    id: string;
    platform: 'DOUYIN' | 'BILIBILI' | 'YOUTUBE';
    externalId: string;
    canonicalUrl: string | null;
    title: string | null;
  } | null;
  existingTaskId: string | null;
  existingVideoStatus: string | null;
};

export class PrismaIngestRepository implements IngestRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly profiles: PrismaProfileRepository,
  ) {}

  async preflight(input: IngestSelection): Promise<IngestPreflight> {
    return this.prisma.$transaction(async (tx) => {
      const evaluated = await this.evaluate(tx, input);
      return preflightView(evaluated.items.map(({ item }) => item));
    }, { isolationLevel: 'RepeatableRead' });
  }

  async create(
    input: IngestSelection,
    idempotencyKey: string,
    requestHash: string,
    requestId?: string,
  ): Promise<IngestCreateResult> {
    const keyHash = createHash('sha256').update(idempotencyKey).digest('hex');
    try {
      return await this.createTransaction(input, keyHash, requestHash, requestId);
    } catch (error) {
      const winner = await this.prisma.idempotencyRecord.findUnique({
        where: { scope_key: { scope: IDEMPOTENCY_SCOPE, key: keyHash } },
      });
      if (winner) {
        if (winner.requestHash !== requestHash) throw reusedKey();
        return winner.responseBody as unknown as IngestCreateResult;
      }
      if (isUnique(error)) return this.createTransaction(input, keyHash, requestHash, requestId);
      throw error;
    }
  }

  private createTransaction(
    input: IngestSelection,
    keyHash: string,
    requestHash: string,
    requestId?: string,
  ): Promise<IngestCreateResult> {
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.idempotencyRecord.findUnique({
        where: { scope_key: { scope: IDEMPOTENCY_SCOPE, key: keyHash } },
      });
      if (previous) {
        if (previous.requestHash !== requestHash) throw reusedKey();
        return previous.responseBody as unknown as IngestCreateResult;
      }

      const evaluated = await this.evaluate(tx, input);
      const canReturn = evaluated.items.some(({ item }) =>
        ['READY', 'READY_RETRY', 'ALREADY_QUEUED', 'ALREADY_INGESTED'].includes(item.disposition));
      if (!canReturn) throw new IngestError('INGEST_NO_CREATABLE_ITEMS', 'No selected source content can create or reuse an ingest job');

      const items: IngestCreateItem[] = [];
      const createdJobIds: string[] = [];
      for (const evaluation of evaluated.items) {
        const { item } = evaluation;
        if (item.disposition === 'ALREADY_QUEUED') {
          items.push({
            sourceContentId: item.sourceContentId, result: 'ALREADY_QUEUED',
            videoId: item.existingVideoId, jobId: item.existingJobId,
            taskId: evaluation.existingTaskId, jobStatus: 'QUEUED',
            videoStatus: evaluation.existingVideoStatus, issues: [],
          });
          continue;
        }
        if (item.disposition === 'ALREADY_INGESTED') {
          items.push({
            sourceContentId: item.sourceContentId, result: 'ALREADY_INGESTED',
            videoId: item.existingVideoId, jobId: null, taskId: null,
            jobStatus: null, videoStatus: evaluation.existingVideoStatus, issues: [],
          });
          continue;
        }
        if (!['READY', 'READY_RETRY'].includes(item.disposition) || !evaluation.source || !evaluated.snapshot) {
          items.push({
            sourceContentId: item.sourceContentId, result: 'SKIPPED_INVALID',
            videoId: item.existingVideoId, jobId: item.existingJobId, taskId: null,
            jobStatus: null, videoStatus: evaluation.existingVideoStatus,
            issues: [item.disposition, ...item.issues],
          });
          continue;
        }

        const video = item.existingVideoId
          ? await tx.video.update({
            where: { id: item.existingVideoId },
            data: { status: 'INGEST_QUEUED', version: { increment: 1 } },
          })
          : await tx.video.create({ data: {
            id: uuidV7(), sourceContentId: evaluation.source.id,
            channelProfileId: input.channelProfileId, seriesProfileId: input.seriesProfileId ?? null,
            status: 'INGEST_QUEUED', sourceLanguage: 'und',
            targetLanguage: evaluated.snapshot.pipeline.targetLanguage,
            displayTitle: evaluation.source.title, createdById: OWNER_ID,
          } });
        const jobId = uuidV7();
        const taskId = uuidV7();
        const now = new Date();
        await tx.pipelineJob.create({ data: {
          id: jobId, videoId: video.id, kind: 'INGEST', status: 'QUEUED',
          pipelineVersion: 'ingest-v1',
          profileSnapshot: evaluated.snapshot as unknown as Prisma.InputJsonValue,
          requestedOutputs: {
            output16x9Enabled: evaluated.snapshot.pipeline.output16x9Enabled,
            output9x16Enabled: evaluated.snapshot.pipeline.output9x16Enabled,
          },
          priority: 0, createdById: OWNER_ID,
        } });
        await tx.pipelineTask.create({ data: {
          id: taskId, pipelineJobId: jobId, taskType: 'DOWNLOAD', resourceClass: 'IO',
          status: 'READY', priority: 0, readyAt: now, attemptCount: 0, maxAttempts: 3,
          inputManifest: {
            schemaVersion: 1, sourceAccountId: input.sourceAccountId,
            sourceContentId: evaluation.source.id, platform: evaluation.source.platform,
            externalId: evaluation.source.externalId, canonicalUrl: evaluation.source.canonicalUrl,
          },
          configuration: {},
        } });
        createdJobIds.push(jobId);
        items.push({
          sourceContentId: item.sourceContentId, result: 'CREATED', videoId: video.id,
          jobId, taskId, jobStatus: 'QUEUED', videoStatus: 'INGEST_QUEUED', issues: [],
        });
      }

      const result = createView(items);
      await tx.auditEvent.create({ data: {
        id: uuidV7(), actorType: 'USER', actorId: OWNER_ID,
        action: 'INGEST_JOBS_CREATED', entityType: 'PIPELINE_JOB',
        entityId: createdJobIds[0] ?? null, requestId: requestId ?? null,
        metadataSafe: {
          sourceAccountId: input.sourceAccountId, channelProfileId: input.channelProfileId,
          seriesProfileId: input.seriesProfileId ?? null, jobIds: createdJobIds,
          ...result.summary,
        },
      } });
      await tx.idempotencyRecord.create({ data: {
        id: uuidV7(), scope: IDEMPOTENCY_SCOPE, key: keyHash, requestHash,
        responseBody: result as unknown as Prisma.InputJsonValue, responseEtag: '"1"',
      } });
      return result;
    }, { isolationLevel: 'RepeatableRead' });
  }

  private async evaluate(tx: Prisma.TransactionClient, input: IngestSelection): Promise<{
    items: Evaluation[];
    snapshot: ProfileJobSnapshot | null;
  }> {
    const now = new Date();
    const [account, series, sources] = await Promise.all([
      tx.sourceAccount.findUnique({
        where: { id: input.sourceAccountId },
        include: { credentials: {
          where: { kind: 'NETSCAPE_COOKIE', revokedAt: null },
          orderBy: { encryptedAt: 'desc' }, take: 1,
        } },
      }),
      input.seriesProfileId
        ? tx.seriesProfile.findUnique({ where: { id: input.seriesProfileId }, select: { channelProfileId: true } })
        : Promise.resolve(null),
      tx.sourceContent.findMany({
        where: { id: { in: input.sourceContentIds } },
        select: {
          id: true, platform: true, externalId: true, canonicalUrl: true, title: true,
          availability: true, isIngestEligible: true,
          discoveryItems: {
            where: { discoveryRun: { sourceAccountId: input.sourceAccountId } },
            select: { id: true }, take: 1,
          },
          videos: {
            where: { channelProfileId: input.channelProfileId }, take: 1,
            select: {
              id: true, seriesProfileId: true, status: true,
              jobs: {
                where: { kind: 'INGEST', status: { in: [...ACTIVE_JOB_STATUSES] } },
                orderBy: { createdAt: 'desc' }, take: 1,
                select: { id: true, tasks: { where: { taskType: 'DOWNLOAD' }, take: 1, select: { id: true } } },
              },
            },
          },
        },
      }),
    ]);

    let profileDisposition: IngestDisposition | null = null;
    let profileIssues: string[] = [];
    let snapshot: ProfileJobSnapshot | null = null;
    if (input.seriesProfileId && !series) profileDisposition = 'SERIES_NOT_READY';
    else if (series && series.channelProfileId !== input.channelProfileId) profileDisposition = 'SERIES_CHANNEL_MISMATCH';
    else {
      try {
        snapshot = await this.profiles.snapshotForJobInTransaction(tx, {
          channelProfileId: input.channelProfileId,
          ...(input.seriesProfileId ? { seriesProfileId: input.seriesProfileId } : {}),
        });
      } catch (error) {
        if (!(error instanceof ProfileError)) throw error;
        profileDisposition = input.seriesProfileId ? 'SERIES_NOT_READY' : 'PROFILE_NOT_READY';
        profileIssues = profileIssueCodes(error.message);
      }
    }

    const sourceById = new Map(sources.map((source) => [source.id, source]));
    const credential = account?.credentials[0];
    const accountUnavailable = !account || account.status !== 'ACTIVE'
      || (account.cooldownUntil !== null && account.cooldownUntil > now);
    const credentialUnavailable = !credential || (credential.expiresAt !== null && credential.expiresAt <= now);

    const items = input.sourceContentIds.map((sourceContentId): Evaluation => {
      const source = sourceById.get(sourceContentId);
      const video = source?.videos[0];
      const job = video?.jobs[0];
      const base = {
        sourceContentId, existingVideoId: video?.id ?? null,
        existingJobId: job?.id ?? null, issues: [] as string[],
      };
      let disposition: IngestDisposition;
      if (!source) disposition = 'SOURCE_NOT_FOUND';
      else if (!account || source.platform !== account.platform || source.discoveryItems.length === 0) disposition = 'SOURCE_ACCOUNT_UNAVAILABLE';
      else if (source.availability !== 'AVAILABLE') disposition = 'SOURCE_UNAVAILABLE';
      else if (!source.isIngestEligible) disposition = 'SOURCE_NOT_INGEST_ELIGIBLE';
      else if (accountUnavailable) disposition = 'SOURCE_ACCOUNT_UNAVAILABLE';
      else if (credentialUnavailable) disposition = 'SOURCE_CREDENTIAL_REQUIRED';
      else if (profileDisposition) disposition = profileDisposition;
      else if (video && video.seriesProfileId !== (input.seriesProfileId ?? null)) disposition = 'VIDEO_PROFILE_CONFLICT';
      else if (job) disposition = 'ALREADY_QUEUED';
      else if (video && !['FAILED', 'INGEST_QUEUED'].includes(video.status)) disposition = 'ALREADY_INGESTED';
      else if (video) disposition = 'READY_RETRY';
      else disposition = 'READY';
      return {
        item: { ...base, disposition, issues: profileDisposition === disposition ? profileIssues : [] },
        source: source ? {
          id: source.id, platform: source.platform, externalId: source.externalId,
          canonicalUrl: source.canonicalUrl, title: source.title,
        } : null,
        existingTaskId: job?.tasks[0]?.id ?? null,
        existingVideoStatus: video?.status ?? null,
      };
    });
    return { items, snapshot };
  }
}

function preflightView(items: IngestPreflightItem[]): IngestPreflight {
  const ready = items.filter((item) => ['READY', 'READY_RETRY'].includes(item.disposition)).length;
  return { summary: { total: items.length, ready, blocked: items.length - ready }, items };
}

function createView(items: IngestCreateItem[]): IngestCreateResult {
  const created = items.filter((item) => item.result === 'CREATED').length;
  const reused = items.filter((item) => ['ALREADY_QUEUED', 'ALREADY_INGESTED'].includes(item.result)).length;
  return { summary: { total: items.length, created, reused, skipped: items.length - created - reused }, items };
}

function profileIssueCodes(message: string): string[] {
  const separator = message.indexOf(':');
  if (separator < 0) return ['PROFILE_NOT_READY'];
  return message.slice(separator + 1).split(',').map((issue) => issue.trim()).filter(Boolean);
}

function reusedKey(): IngestError {
  return new IngestError('IDEMPOTENCY_KEY_REUSED', 'Idempotency key was used for a different request');
}

function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
