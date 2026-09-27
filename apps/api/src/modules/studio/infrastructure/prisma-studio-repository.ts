import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { StudioEnvelope, StudioReviewRequest, StudioSegmentPatch } from '@reup-dubbing-studio/api-contract';
import { uuidV7 } from '../../../platform/ids/uuid-v7';
import { StudioError } from '../domain/studio-errors';
import { resolveReviewPolicySnapshot } from '../../review-policy/infrastructure/prisma-review-policy-repository';
import { PipelineOrchestrator } from '../../workers/infrastructure/pipeline-orchestrator';
/* eslint-disable @typescript-eslint/no-explicit-any, @stylistic/brace-style */
const OWNER_ID = '01994429-ec00-7000-8000-000000000002';
const activeJobs = ['QUEUED','RUNNING','WAITING_FOR_GPU','WAITING_FOR_REVIEW'] as const;
export type SegmentPatch = StudioSegmentPatch;
export type ReviewInput = StudioReviewRequest;
export class PrismaStudioRepository {
  private readonly orchestrator: PipelineOrchestrator;
  constructor(private readonly prisma: PrismaClient) { this.orchestrator = new PipelineOrchestrator(prisma); }
  async detail(videoId: string) { const row = await this.prisma.video.findUnique({
    where: { id: videoId }, include: {
      sourceContent: true,
      seriesProfile: { include: { castSheet: { include: { entries: { include: { voiceProfile: true } } } } } },
      segments: { orderBy: { ordinal: 'asc' }, include: { currentRevision: { include: { voiceProfile: true, castSheetEntry: true, audioRevisions: { orderBy: { revision: 'desc' }, include: { asset: true } } } } } },
      transcriptRuns: { orderBy: { createdAt: 'desc' } },
      reviewDecisions: { orderBy: { decidedAt: 'desc' }, take: 20 },
      jobs: { where: { status: { in: [...activeJobs] } }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  }); if (!row) missing(); return view(row); }
  async edit(videoId: string, segmentId: string, expectedVersion: number, patch: SegmentPatch) { return this.prisma.$transaction(async (tx) => { const video = await tx.video.findUnique({ where: { id: videoId } }); if (!video) missing(); if (video.version !== expectedVersion) conflict(); const segment = await tx.videoSegment.findFirst({ where: { id: segmentId, videoId }, include: { currentRevision: true } }); if (!segment?.currentRevision) throw new StudioError('SEGMENT_NOT_FOUND', 'Segment was not found'); const current = segment.currentRevision; if (patch.targetStartMs !== undefined && patch.targetEndMs !== undefined && patch.targetEndMs <= patch.targetStartMs) throw new StudioError('STUDIO_VALIDATION_FAILED', 'Segment end must be after start'); if (patch.voiceProfileId && !await tx.voiceProfile.findFirst({ where: { id: patch.voiceProfileId, status: 'READY' } })) throw new StudioError('VOICE_NOT_READY', 'Voice is not ready'); const revision = await tx.segmentRevision.create({ data: { id: uuidV7(), videoSegmentId: segment.id, revision: current.revision + 1, sourceText: current.sourceText, translatedText: patch.translatedText ?? current.translatedText, castSheetEntryId: patch.castSheetEntryId === undefined ? current.castSheetEntryId : patch.castSheetEntryId, voiceProfileId: patch.voiceProfileId ?? current.voiceProfileId, targetStartMs: patch.targetStartMs ?? current.targetStartMs, targetEndMs: patch.targetEndMs ?? current.targetEndMs, speechRate: patch.speechRate ?? current.speechRate, editReason: patch.editReason ?? null, createdBy: OWNER_ID } }); await tx.segmentRevision.update({ where: { id: current.id }, data: { status: 'SUPERSEDED' } }); await tx.videoSegment.update({ where: { id: segment.id }, data: { currentRevisionId: revision.id } }); await tx.video.update({ where: { id: videoId }, data: { version: { increment: 1 }, status: 'AWAITING_REVIEW' } }); await tx.outboxMessage.create({ data: { id: uuidV7(), aggregateType: 'VIDEO', aggregateId: videoId, eventType: 'studio.invalidate', payloadSafe: { videoId, reason: 'SEGMENT_EDITED' } } }); return { videoId, segmentId, revisionId: revision.id, revision: revision.revision, version: video.version + 1 }; }, { isolationLevel: 'Serializable' }); }
  async previewAsset(videoId: string, segmentId: string) { const audio = await this.prisma.segmentAudioRevision.findFirst({ where: { videoSegmentId: segmentId, segment: { videoId }, status: { in: ['READY','SELECTED'] }, asset: { status: 'AVAILABLE', deletedAt: null } }, orderBy: { revision: 'desc' }, include: { asset: true } }); if (!audio?.asset) throw new StudioError('PREVIEW_NOT_AVAILABLE', 'Segment preview is not available'); return audio.asset; }
  async regenerate(videoId: string, segmentId: string, expectedVersion: number, key: string) { if (!await this.prisma.videoSegment.findFirst({ where: { id: segmentId, videoId }, select: { id: true } })) throw new StudioError('SEGMENT_NOT_FOUND', 'Segment was not found'); return this.createJob('STUDIO_REGENERATE_V1', videoId, expectedVersion, key, 'REGENERATE_SEGMENT', { segmentId }); }
  render(videoId: string, expectedVersion: number, key: string) { return this.createJob('STUDIO_RENDER_V1', videoId, expectedVersion, key, 'RENDER', {}); }
  async review(videoId: string, expectedVersion: number, input: ReviewInput) { return this.prisma.$transaction(async (tx) => {
    const video = await tx.video.findUnique({ where: { id: videoId } });
    if (!video) missing();
    if (video.version !== expectedVersion || input.subjectVersion !== String(video.version)) conflict();
    const decision = await tx.reviewDecision.create({ data: {
      id: uuidV7(), videoId, scope: input.scope, subjectVersion: input.subjectVersion,
      decision: input.decision, note: input.note ?? null, decidedBy: OWNER_ID,
    } });
    let resumeTaskId: string | null = null;
    if (input.decision === 'APPROVED' && input.scope === 'TTS') {
      const reviewTask = await tx.pipelineTask.findFirst({
        where: { pipelineJob: { videoId }, taskType: 'WAIT_FOR_REVIEW', status: 'WAITING' },
        orderBy: { createdAt: 'desc' },
      });
      if (reviewTask) {
        await tx.pipelineTask.update({ where: { id: reviewTask.id }, data: {
          status: 'SUCCEEDED', progressBps: 10_000, version: { increment: 1 },
        } });
        resumeTaskId = reviewTask.id;
        await this.orchestrator.unlockDependents(tx, reviewTask.id);
        await this.orchestrator.refreshAggregateStatus(tx, reviewTask.pipelineJobId);
      }
    }
    const updated = await tx.video.update({ where: { id: videoId }, data: {
      version: { increment: 1 }, status: resumeTaskId ? 'PROCESSING' : 'AWAITING_REVIEW',
    } });
    await tx.outboxMessage.create({ data: {
      id: uuidV7(), aggregateType: 'VIDEO', aggregateId: videoId, eventType: 'studio.invalidate',
      payloadSafe: { videoId, reason: 'REVIEW_DECIDED', resumedTaskId: resumeTaskId },
    } });
    return { id: decision.id, ...input, note: input.note ?? null, decidedAt: decision.decidedAt.toISOString(), version: updated.version };
  }, { isolationLevel: 'Serializable' }); }
  private async createJob(scope: string, videoId: string, version: number, key: string, taskType: 'REGENERATE_SEGMENT'|'RENDER', extra: Record<string,string>) {
    const keyHash = createHash('sha256').update(key).digest('hex');
    const requestHash = createHash('sha256').update(JSON.stringify({ videoId, version, ...extra })).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      const prior = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key: keyHash } } });
      if (prior) {
        if (prior.requestHash !== requestHash) throw new StudioError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was used for another request');
        return prior.responseBody as { jobId: string; taskId: string; version: number };
      }
      const video = await tx.video.findUnique({ where: { id: videoId } });
      if (!video) missing();
      if (video.version !== version) conflict();
      if (await tx.pipelineJob.findFirst({ where: { videoId, status: { in: [...activeJobs] } } })) {
        throw new StudioError('STUDIO_VALIDATION_FAILED', 'Video already has an active pipeline job');
      }
      const reviewPolicy = await resolveReviewPolicySnapshot(tx, { channelProfileId: video.channelProfileId, seriesProfileId: video.seriesProfileId });
      const sourceJob = await tx.pipelineJob.findFirst({ where: { videoId, kind: 'FULL_PIPELINE' }, orderBy: { createdAt: 'desc' } });
      const sourceSnapshot = object(sourceJob?.profileSnapshot);
      const pipeline = object(sourceSnapshot.pipeline);
      const jobId = uuidV7(); const taskId = uuidV7();
      const execution = taskType === 'REGENERATE_SEGMENT'
        ? await regenerateExecution(tx, videoId, extra.segmentId!, video.targetLanguage, pipeline)
        : await renderExecution(tx, videoId, sourceJob?.requestedOutputs);
      await tx.pipelineJob.create({ data: {
        id: jobId, videoId, kind: taskType === 'RENDER' ? 'RERENDER' : 'REGENERATE_CONTENT',
        status: 'WAITING_FOR_GPU', pipelineVersion: 'studio-v2',
        profileSnapshot: sourceJob?.profileSnapshot ?? { studioVideoVersion: version, reviewPolicy },
        requestedOutputs: taskType === 'RENDER' ? execution.requestedOutputs : {}, createdById: OWNER_ID,
        tasks: { create: {
          id: taskId, taskType, resourceClass: taskType === 'RENDER' ? 'GPU_BATCH' : 'GPU_TTS_INTERACTIVE',
          status: 'READY', readyAt: new Date(), inputManifest: execution.inputManifest,
          configuration: execution.configuration, requiredCapabilities: execution.requiredCapabilities,
          minimumVramMb: execution.minimumVramMb, minimumScratchBytes: execution.minimumScratchBytes,
        } },
      } });
      const updated = await tx.video.update({ where: { id: videoId }, data: { status: 'PROCESSING', version: { increment: 1 } } });
      const result = { jobId, taskId, version: updated.version };
      await tx.idempotencyRecord.create({ data: { id: uuidV7(), scope, key: keyHash, requestHash, responseBody: result, responseEtag: `"${updated.version}"` } });
      return result;
    }, { isolationLevel: 'Serializable' });
  }
}

async function regenerateExecution(tx: Prisma.TransactionClient, videoId: string, segmentId: string, targetLanguage: string, pipeline: Record<string, unknown>) {
  const segment = await tx.videoSegment.findFirst({
    where: { id: segmentId, videoId }, include: { currentRevision: { include: { voiceProfile: { include: { samples: { where: { isCurrent: true }, include: { asset: true } } } } } } },
  });
  if (!segment?.currentRevision) throw new StudioError('SEGMENT_NOT_FOUND', 'Segment was not found');
  const revision = segment.currentRevision;
  const sample = revision.voiceProfile.samples.find((item) => item.language.toLowerCase() === targetLanguage.toLowerCase())
    ?? revision.voiceProfile.samples.find((item) => item.language.toLowerCase() === revision.voiceProfile.primaryLanguage.toLowerCase());
  if (!sample || sample.asset.status !== 'AVAILABLE') throw new StudioError('VOICE_NOT_READY', 'Voice sample is unavailable');
  const outputSlot = 'dub-segment';
  return {
    configuration: {
      kind: 'REGENERATE_SEGMENT', speed: number(pipeline.ttsSpeed, Number(revision.speechRate)),
      timingPolicy: timingPolicy(pipeline.timingPolicy), segment: {
        segmentRevisionId: revision.id, text: revision.translatedText, languageId: targetLanguage,
        voiceProfileId: revision.voiceProfileId, targetDurationMs: revision.targetEndMs - revision.targetStartMs, outputSlot,
      },
    } as Prisma.InputJsonValue,
    inputManifest: {
      inputs: [{ slot: 'voice-sample', kind: 'VOICE_SAMPLE', assetId: sample.assetId, metadata: {
        voiceProfileId: revision.voiceProfileId, languageId: targetLanguage, referenceText: sample.transcript,
      } }],
      outputs: [{ slot: outputSlot, kind: 'DUB_AUDIO', minItems: 1, maxItems: 1, allowedContentTypes: ['audio/wav'], maxByteSize: '104857600' }],
    } as Prisma.InputJsonValue,
    requiredCapabilities: ['tts.omnivoice.v1'], minimumVramMb: 4096, minimumScratchBytes: BigInt(1024 * 1024 * 1024), requestedOutputs: {},
  };
}

async function renderExecution(tx: Prisma.TransactionClient, videoId: string, requestedValue: Prisma.JsonValue | undefined) {
  const raw = await tx.videoAsset.findFirst({ where: { videoId, kind: 'RAW', isCurrent: true }, orderBy: { revision: 'desc' } });
  const background = await tx.videoAsset.findFirst({ where: { videoId, kind: 'BACKGROUND_AUDIO', isCurrent: true }, orderBy: { revision: 'desc' } });
  const dubs = await tx.segmentAudioRevision.findMany({
    where: { segment: { videoId }, status: 'SELECTED', assetId: { not: null } }, include: { segment: true }, orderBy: { segment: { ordinal: 'asc' } },
  });
  if (!raw || !background || !dubs.length) throw new StudioError('STUDIO_VALIDATION_FAILED', 'Render inputs are not ready');
  const requested = object(requestedValue);
  const variants = [
    ...(requested.output16x9Enabled !== false ? [{ variant: 'FULL_16X9', outputSlot: 'video-16x9' }] : []),
    ...(requested.output9x16Enabled === true ? [{ variant: 'HIGHLIGHT_9X16', outputSlot: 'video-9x16' }] : []),
  ];
  if (!variants.length) throw new StudioError('STUDIO_VALIDATION_FAILED', 'No render output variant is enabled');
  return {
    configuration: { kind: 'RENDER', subtitleMode: 'EXTERNAL_ONLY', variants } as Prisma.InputJsonValue,
    inputManifest: {
      inputs: [
        { slot: 'raw', kind: 'RAW', assetId: raw.assetId, metadata: {} },
        { slot: 'background', kind: 'BACKGROUND_AUDIO', assetId: background.assetId, metadata: {} },
        ...dubs.map((dub, index) => ({ slot: `dub-${index + 1}`, kind: 'DUB_AUDIO', assetId: dub.assetId!, metadata: { ordinal: dub.segment.ordinal, targetStartMs: dub.segment.sourceStartMs, gainDb: 0 } })),
      ],
      outputs: variants.map((variant) => ({ slot: variant.outputSlot, kind: 'OUTPUT_VIDEO', minItems: 1, maxItems: 1, allowedContentTypes: ['video/mp4'], maxByteSize: '10737418240' })),
    } as Prisma.InputJsonValue,
    requiredCapabilities: ['media.render.ffmpeg.v1'], minimumVramMb: 512, minimumScratchBytes: BigInt(5 * 1024 * 1024 * 1024),
    requestedOutputs: { output16x9Enabled: requested.output16x9Enabled !== false, output9x16Enabled: requested.output9x16Enabled === true },
  };
}

function object(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function number(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function timingPolicy(value: unknown): 'PRESERVE_SEGMENT'|'FIT_SEGMENT'|'ALLOW_DRIFT' { return ['PRESERVE_SEGMENT','FIT_SEGMENT','ALLOW_DRIFT'].includes(String(value)) ? value as 'PRESERVE_SEGMENT'|'FIT_SEGMENT'|'ALLOW_DRIFT' : 'FIT_SEGMENT'; }
function missing(): never { throw new StudioError('VIDEO_NOT_FOUND', 'Video was not found'); }
function conflict(): never { throw new StudioError('VERSION_CONFLICT', 'Studio version is stale'); }
function view(row: any): StudioEnvelope['data'] { return { video: { id: row.id, version: row.version, title: row.displayTitle, status: row.status, sourceDurationMs: sourceDuration(row) }, transcriptRuns: row.transcriptRuns.map((run: any) => ({ id: run.id, method: run.method, status: run.status, language: run.language, averageConfidence: run.averageConfidence?.toString() ?? null, selectedAt: run.selectedAt?.toISOString() ?? null })), cast: row.seriesProfile?.castSheet ? { id: row.seriesProfile.castSheet.id, status: row.seriesProfile.castSheet.status, version: row.seriesProfile.castSheet.version, entries: row.seriesProfile.castSheet.entries.map((entry: any) => ({ id: entry.id, characterKey: entry.characterKey, displayName: entry.displayName, roleKind: entry.roleKind, voice: { id: entry.voiceProfile.id, name: entry.voiceProfile.name } })) } : null, segments: row.segments.map((segment: any) => ({ id: segment.id, ordinal: segment.ordinal, sourceStartMs: segment.sourceStartMs, sourceEndMs: segment.sourceEndMs, revision: segment.currentRevision ? { id: segment.currentRevision.id, revision: segment.currentRevision.revision, sourceText: segment.currentRevision.sourceText, translatedText: segment.currentRevision.translatedText, targetStartMs: segment.currentRevision.targetStartMs, targetEndMs: segment.currentRevision.targetEndMs, speechRate: Number(segment.currentRevision.speechRate), status: segment.currentRevision.status, castSheetEntryId: segment.currentRevision.castSheetEntryId, voice: { id: segment.currentRevision.voiceProfile.id, name: segment.currentRevision.voiceProfile.name }, preview: segment.currentRevision.audioRevisions[0] ? { id: segment.currentRevision.audioRevisions[0].id, status: segment.currentRevision.audioRevisions[0].status, durationMs: segment.currentRevision.audioRevisions[0].actualDurationMs } : null } : null })), reviews: row.reviewDecisions.map((item: any) => ({ id: item.id, scope: item.scope, subjectVersion: item.subjectVersion, decision: item.decision, note: item.note, decidedAt: item.decidedAt.toISOString() })), capabilities: { canEdit: row.status !== 'ARCHIVED', canRegenerate: row.status !== 'ARCHIVED', canRender: row.segments.length > 0 && !row.jobs.length } }; }
function sourceDuration(row: any): number | null { if (row.sourceContent?.durationMs !== undefined) return row.sourceContent.durationMs; const metadata = row.localSourceMetadata; return metadata && typeof metadata === 'object' && !Array.isArray(metadata) && typeof metadata.durationMs === 'number' ? metadata.durationMs : null; }
