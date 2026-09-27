import type { PipelineTask, Prisma, PrismaClient } from '@prisma/client';

import { uuidV7 } from '../../../platform/ids/uuid-v7';
import type { ProfileJobSnapshot } from '../../profiles';
import { WorkerError } from '../domain/worker-errors';

type OutputReference = { slot: string; assetId: string };

/**
 * Applies the durable side effects of a completed task and advances its DAG.
 * All methods run inside the caller's transaction so a task can never be
 * SUCCEEDED without its domain output, or unlock a dependent too early.
 */
export class PipelineOrchestrator {
  constructor(private readonly prisma: PrismaClient) {}

  async afterWorkerSucceeded(
    tx: Prisma.TransactionClient,
    task: PipelineTask,
    attemptId: string,
    outputs: OutputReference[],
  ): Promise<void> {
    const job = await tx.pipelineJob.findUniqueOrThrow({ where: { id: task.pipelineJobId } });
    const assets = await tx.asset.findMany({ where: { id: { in: outputs.map((item) => item.assetId) } } });
    const bySlot = new Map(outputs.map((output) => [output.slot, assets.find((asset) => asset.id === output.assetId)!]));

    switch (task.taskType) {
      case 'TRANSCRIBE_ASR': {
        const output = onlyOutput(task.inputManifest, 'ASR_JSON', bySlot);
        await linkVideoAsset(tx, job.videoId, output.id, 'ASR_JSON');
        break;
      }
      case 'GENERATE_INITIAL_TTS':
      case 'REGENERATE_SEGMENT': {
        const configuration = object(task.configuration);
        const segments = task.taskType === 'REGENERATE_SEGMENT'
          ? [object(configuration.segment)]
          : array(configuration.segments).map(object);
        for (const segment of segments) {
          const segmentRevisionId = text(segment.segmentRevisionId);
          const output = bySlot.get(text(segment.outputSlot));
          if (!output) invalid('A TTS output is missing for a segment');
          const revision = await tx.segmentRevision.findUnique({
            where: { id: segmentRevisionId }, select: { id: true, videoSegmentId: true },
          });
          if (!revision) invalid('TTS output references an unknown segment revision');
          const latest = await tx.segmentAudioRevision.aggregate({
            where: { segmentRevisionId }, _max: { revision: true },
          });
          await tx.segmentAudioRevision.updateMany({
            where: { videoSegmentId: revision.videoSegmentId, status: 'SELECTED' }, data: { status: 'READY' },
          });
          await tx.segmentAudioRevision.create({ data: {
            id: uuidV7(), videoSegmentId: revision.videoSegmentId, segmentRevisionId,
            assetId: output.id, taskAttemptId: attemptId, revision: (latest._max.revision ?? 0) + 1,
            modelName: 'OmniVoice', modelVersion: 'worker-image',
            targetDurationMs: integer(segment.targetDurationMs), actualDurationMs: output.durationMs,
            status: 'SELECTED',
          } });
          await linkVideoAsset(tx, job.videoId, output.id, 'DUB_AUDIO', segmentRevisionId);
        }
        break;
      }
      case 'SEPARATE_AUDIO': {
        const output = onlyOutput(task.inputManifest, 'BACKGROUND_AUDIO', bySlot);
        await linkVideoAsset(tx, job.videoId, output.id, 'BACKGROUND_AUDIO');
        break;
      }
      case 'RENDER': {
        const configuration = object(task.configuration);
        for (const variantConfig of array(configuration.variants).map(object)) {
          const variant = text(variantConfig.variant) as 'FULL_16X9' | 'HIGHLIGHT_9X16';
          if (!['FULL_16X9', 'HIGHLIGHT_9X16'].includes(variant)) invalid('Render output variant is invalid');
          const output = bySlot.get(text(variantConfig.outputSlot));
          if (!output) invalid('A declared render output is missing');
          const videoAsset = await linkVideoAsset(tx, job.videoId, output.id, 'OUTPUT_VIDEO', variant);
          const subtitle = await tx.videoAsset.findFirst({
            where: { videoId: job.videoId, kind: 'OUTPUT_SUBTITLE', isCurrent: true }, orderBy: { revision: 'desc' },
          });
          const latest = await tx.renderOutput.aggregate({ where: { videoId: job.videoId, variant }, _max: { revision: true } });
          await tx.renderOutput.create({ data: {
            id: uuidV7(), videoId: job.videoId, pipelineJobId: job.id, variant,
            revision: (latest._max.revision ?? 0) + 1, videoAssetId: videoAsset.id,
            subtitleAssetId: subtitle?.id ?? null, status: 'READY',
          } });
        }
        break;
      }
      default:
        break;
    }

    await this.unlockDependents(tx, task.id);
    await this.refreshAggregateStatus(tx, task.pipelineJobId);
  }

  async unlockDependents(tx: Prisma.TransactionClient, completedTaskId: string): Promise<void> {
    const candidates = await tx.pipelineTask.findMany({
      where: { status: 'BLOCKED', dependencies: { some: { dependsOnTaskId: completedTaskId } } },
      include: { dependencies: { include: { dependsOn: { select: { status: true } } } }, pipelineJob: true },
    });
    for (const task of candidates) {
      if (!task.dependencies.every((dependency) => dependency.dependsOn.status === 'SUCCEEDED')) continue;
      const snapshot = task.pipelineJob.profileSnapshot as unknown as ProfileJobSnapshot;
      const prepared = await prepareTask(tx, task, task.pipelineJob.videoId, snapshot);
      await tx.pipelineTask.update({ where: { id: task.id }, data: {
        status: task.taskType === 'WAIT_FOR_REVIEW' ? 'WAITING' : 'READY',
        readyAt: task.taskType === 'WAIT_FOR_REVIEW' ? null : new Date(),
        ...prepared, version: { increment: 1 },
      } });
      if (task.taskType === 'WAIT_FOR_REVIEW') {
        await tx.video.update({ where: { id: task.pipelineJob.videoId }, data: { status: 'AWAITING_REVIEW', version: { increment: 1 } } });
      }
    }
  }

  async refreshAggregateStatus(tx: Prisma.TransactionClient, jobId: string): Promise<void> {
    const job = await tx.pipelineJob.findUniqueOrThrow({ where: { id: jobId }, include: { tasks: true } });
    const now = new Date();
    if (job.tasks.every((task) => task.status === 'SUCCEEDED')) {
      await tx.pipelineJob.update({ where: { id: jobId }, data: { status: 'SUCCEEDED', finishedAt: now, version: { increment: 1 } } });
      await tx.video.update({ where: { id: job.videoId }, data: { status: 'READY_TO_PUBLISH', version: { increment: 1 } } });
      return;
    }
    const failed = job.tasks.find((task) => task.status === 'FAILED');
    if (failed) {
      await tx.pipelineJob.update({ where: { id: jobId }, data: { status: 'FAILED', finishedAt: now, version: { increment: 1 } } });
      await tx.video.update({ where: { id: job.videoId }, data: { status: 'FAILED', version: { increment: 1 } } });
      return;
    }
    const waitingReview = job.tasks.some((task) => task.taskType === 'WAIT_FOR_REVIEW' && task.status === 'WAITING');
    const readyGpu = job.tasks.some((task) => task.status === 'READY' && ['GPU_BATCH', 'GPU_TTS_INTERACTIVE'].includes(task.resourceClass));
    await tx.pipelineJob.update({ where: { id: jobId }, data: {
      status: waitingReview ? 'WAITING_FOR_REVIEW' : readyGpu ? 'WAITING_FOR_GPU' : 'RUNNING',
      startedAt: job.startedAt ?? now, version: { increment: 1 },
    } });
  }
}

async function prepareTask(
  tx: Prisma.TransactionClient,
  task: PipelineTask,
  videoId: string,
  snapshot: ProfileJobSnapshot,
): Promise<Pick<Prisma.PipelineTaskUpdateInput, 'configuration' | 'inputManifest' | 'requiredCapabilities' | 'minimumVramMb' | 'minimumScratchBytes'>> {
  if (task.taskType === 'GENERATE_INITIAL_TTS') {
    const revisions = await tx.segmentRevision.findMany({
      where: { segment: { videoId }, currentFor: { isNot: null } }, orderBy: { segment: { ordinal: 'asc' } },
      include: { segment: true },
    });
    if (!revisions.length) invalid('Cannot prepare TTS without translated segments');
    const sample = await tx.voiceProfileSample.findFirst({
      where: { id: snapshot.defaultVoice.sampleLinkId, assetId: snapshot.defaultVoice.sampleAssetId, isCurrent: true },
    });
    if (!sample) invalid('The snapshotted voice sample is unavailable');
    const segments = revisions.map((revision, index) => ({
      segmentRevisionId: revision.id, text: revision.translatedText,
      languageId: snapshot.pipeline.targetLanguage, voiceProfileId: revision.voiceProfileId,
      targetDurationMs: revision.targetEndMs - revision.targetStartMs, outputSlot: `dub-${index + 1}`,
    }));
    return {
      configuration: { kind: 'GENERATE_INITIAL_TTS', speed: snapshot.pipeline.ttsSpeed, timingPolicy: snapshot.pipeline.timingPolicy, segments },
      inputManifest: {
        inputs: [{ slot: 'voice-sample', kind: 'VOICE_SAMPLE', assetId: sample.assetId, metadata: {
          voiceProfileId: snapshot.defaultVoice.profileId, languageId: snapshot.pipeline.targetLanguage,
          referenceText: sample.transcript,
        } }],
        outputs: segments.map((segment) => ({ slot: segment.outputSlot, kind: 'DUB_AUDIO', minItems: 1, maxItems: 1, allowedContentTypes: ['audio/wav'], maxByteSize: '104857600' })),
      },
      requiredCapabilities: ['tts.omnivoice.v1'], minimumVramMb: 4096, minimumScratchBytes: BigInt(1024 * 1024 * 1024),
    };
  }
  if (task.taskType === 'SEPARATE_AUDIO') {
    const raw = await currentVideoAsset(tx, videoId, 'RAW');
    return { inputManifest: {
      inputs: [{ slot: 'raw', kind: 'RAW', assetId: raw.assetId, metadata: {} }],
      outputs: [{ slot: 'background', kind: 'BACKGROUND_AUDIO', minItems: 1, maxItems: 1, allowedContentTypes: ['audio/wav'], maxByteSize: '2147483648' }],
    } };
  }
  if (task.taskType === 'RENDER') {
    const raw = await currentVideoAsset(tx, videoId, 'RAW');
    const background = await currentVideoAsset(tx, videoId, 'BACKGROUND_AUDIO');
    const dubs = await tx.segmentAudioRevision.findMany({
      where: { segment: { videoId }, status: 'SELECTED', assetId: { not: null } },
      include: { segment: true }, orderBy: { segment: { ordinal: 'asc' } },
    });
    if (!dubs.length) invalid('Cannot prepare render without selected dub audio');
    const configuration = object(task.configuration);
    const variants = array(configuration.variants).map(object);
    return { inputManifest: {
      inputs: [
        { slot: 'raw', kind: 'RAW', assetId: raw.assetId, metadata: {} },
        { slot: 'background', kind: 'BACKGROUND_AUDIO', assetId: background.assetId, metadata: {} },
        ...dubs.map((dub, index) => ({ slot: `dub-${index + 1}`, kind: 'DUB_AUDIO', assetId: dub.assetId!, metadata: { ordinal: dub.segment.ordinal, targetStartMs: dub.segment.sourceStartMs, gainDb: 0 } })),
      ],
      outputs: variants.map((variant) => ({ slot: text(variant.outputSlot), kind: 'OUTPUT_VIDEO', minItems: 1, maxItems: 1, allowedContentTypes: ['video/mp4'], maxByteSize: '10737418240' })),
    }, minimumScratchBytes: BigInt(5 * 1024 * 1024 * 1024) };
  }
  return {};
}

async function currentVideoAsset(tx: Prisma.TransactionClient, videoId: string, kind: 'RAW' | 'BACKGROUND_AUDIO') {
  const link = await tx.videoAsset.findFirst({ where: { videoId, kind, isCurrent: true }, orderBy: { revision: 'desc' } });
  if (!link) invalid(`Required ${kind} asset is unavailable`);
  return link;
}

async function linkVideoAsset(tx: Prisma.TransactionClient, videoId: string, assetId: string, kind: 'ASR_JSON' | 'BACKGROUND_AUDIO' | 'DUB_AUDIO' | 'OUTPUT_VIDEO', variantKey: string | null = null) {
  const existing = await tx.videoAsset.findFirst({ where: { videoId, kind, variantKey, assetId } });
  if (existing) return existing;
  const latest = await tx.videoAsset.aggregate({ where: { videoId, kind, variantKey }, _max: { revision: true } });
  await tx.videoAsset.updateMany({ where: { videoId, kind, variantKey, isCurrent: true }, data: { isCurrent: false } });
  return tx.videoAsset.create({ data: { id: uuidV7(), videoId, assetId, kind, variantKey, revision: (latest._max.revision ?? 0) + 1, isCurrent: true } });
}

function onlyOutput(manifestValue: Prisma.JsonValue, kind: string, bySlot: Map<string, { id: string }>) {
  const manifest = object(manifestValue);
  const specifications = array(manifest.outputs).map(object).filter((item) => item.kind === kind);
  if (specifications.length !== 1) invalid(`Task must declare one ${kind} output`);
  const output = bySlot.get(text(specifications[0]!.slot));
  if (!output) invalid(`The ${kind} output is missing`);
  return output;
}

function object(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string { if (typeof value !== 'string' || !value) invalid('Task snapshot contains an invalid string'); return value; }
function integer(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 1) invalid('Task snapshot contains an invalid integer'); return Number(value); }
function invalid(message: string): never { throw new WorkerError('TASK_OUTPUT_INVALID', message); }
