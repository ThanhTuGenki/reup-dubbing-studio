import { type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma, type PipelineTask, type PrismaClient } from '@prisma/client';

import { uuidV7 } from '../../../platform/ids/uuid-v7';
import type { ProfileJobSnapshot } from '../../profiles';
import type { AesGcmCredentialCipher } from '../../settings';
import type { PipelineOrchestrator } from '../infrastructure/pipeline-orchestrator';
import type { R2WorkerObjectStore } from '../infrastructure/r2-worker-object-store';

const INSTANCE = `control-plane:${process.pid}`;
const POLL_MS = 1_000;
const RETRY_MS = 5_000;
const INTERRUPTED_AFTER_MS = 5 * 60_000;

type TranscriptPayload = { segments: Array<{ startMs: number; endMs: number; text: string; confidence?: number }> };
type TranslationPayload = { translations: string[] };
type TaskResult = TranscriptPayload | TranslationPayload | { subtitleAssetId: string } | Record<string, never>;

/** Executes the non-GPU portion of the full pipeline from durable READY tasks. */
export class ControlPlaneRunner implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private active = false;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly objects: R2WorkerObjectStore,
    private readonly cipher: AesGcmCredentialCipher,
    private readonly orchestrator: PipelineOrchestrator,
    private readonly enabled = true,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    await this.recoverInterrupted();
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref();
    void this.tick();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    while (this.active) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  async tick(): Promise<void> {
    if (this.active || this.stopping) return;
    this.active = true;
    try {
      for (let count = 0; count < 20; count += 1) {
        const claimed = await this.claim();
        if (!claimed) break;
        try {
          const result = await this.execute(claimed.task);
          await this.succeed(claimed.task, claimed.attemptId, result);
        } catch (error) {
          await this.fail(claimed.task, claimed.attemptId, safeError(error));
        }
      }
    } catch {
      // A later poll retries database-level failures; task failures are persisted above.
    } finally {
      this.active = false;
    }
  }

  private async recoverInterrupted(): Promise<void> {
    const staleAttempts = await this.prisma.taskAttempt.findMany({
      where: {
        executorKind: 'CONTROL_PLANE', status: 'STARTED',
        startedAt: { lt: new Date(Date.now() - INTERRUPTED_AFTER_MS) },
        pipelineTask: { status: 'RUNNING' },
      },
      include: { pipelineTask: true }, take: 100,
    });
    for (const attempt of staleAttempts) {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.taskAttempt.updateMany({
          where: { id: attempt.id, status: 'STARTED' },
          data: { status: 'TIMED_OUT', finishedAt: new Date(), errorCode: 'CONTROL_PLANE_INTERRUPTED', errorDetailSafe: 'Control Plane execution was interrupted' },
        });
        if (!claimed.count) return;
        const retry = attempt.pipelineTask.attemptCount < attempt.pipelineTask.maxAttempts;
        await tx.pipelineTask.updateMany({
          where: { id: attempt.pipelineTaskId, status: 'RUNNING' },
          data: { status: retry ? 'READY' : 'FAILED', readyAt: retry ? new Date() : null, version: { increment: 1 } },
        });
        await tx.pipelineJob.update({ where: { id: attempt.pipelineTask.pipelineJobId }, data: retry
          ? { status: 'RUNNING', version: { increment: 1 } }
          : { status: 'FAILED', finishedAt: new Date(), failureCode: 'CONTROL_PLANE_INTERRUPTED', failureDetailSafe: 'Control Plane execution was interrupted', version: { increment: 1 } },
        });
      });
    }
  }

  private claim(): Promise<{ task: PipelineTask; attemptId: string } | null> {
    return this.prisma.$transaction(async (tx) => {
      const ids = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM pipeline_tasks
        WHERE status = 'READY'::"PipelineTaskStatus"
          AND resource_class IN ('CPU'::"ResourceClass", 'CONTROL_PLANE'::"ResourceClass")
          AND (ready_at IS NULL OR ready_at <= NOW())
          AND attempt_count < max_attempts
        ORDER BY priority DESC, ready_at ASC NULLS FIRST, id ASC
        FOR UPDATE SKIP LOCKED LIMIT 1
      `);
      if (!ids[0]) return null;
      const current = await tx.pipelineTask.findUniqueOrThrow({ where: { id: ids[0].id } });
      const attemptId = uuidV7();
      const attemptNumber = current.attemptCount + 1;
      await tx.taskAttempt.create({ data: {
        id: attemptId, pipelineTaskId: current.id, attemptNumber,
        executorKind: 'CONTROL_PLANE', executorInstanceId: INSTANCE, status: 'STARTED', startedAt: new Date(),
      } });
      const task = await tx.pipelineTask.update({ where: { id: current.id }, data: {
        status: 'RUNNING', attemptCount: attemptNumber, version: { increment: 1 },
      } });
      await tx.pipelineJob.update({ where: { id: task.pipelineJobId }, data: { status: 'RUNNING', startedAt: new Date(), version: { increment: 1 } } });
      return { task, attemptId };
    });
  }

  private async execute(task: PipelineTask): Promise<TaskResult> {
    const job = await this.prisma.pipelineJob.findUniqueOrThrow({ where: { id: task.pipelineJobId }, include: { video: true } });
    switch (task.taskType) {
      case 'MERGE_TRANSCRIPT': {
        const link = await this.prisma.videoAsset.findFirst({
          where: { videoId: job.videoId, kind: 'ASR_JSON', isCurrent: true }, include: { asset: true },
          orderBy: { revision: 'desc' },
        });
        if (!link) throw new Error('ASR output is unavailable');
        const parsed = JSON.parse((await this.objects.read(link.asset)).toString('utf8')) as unknown;
        return transcript(parsed);
      }
      case 'TRANSLATE': {
        const segments = await this.prisma.videoSegment.findMany({
          where: { videoId: job.videoId }, include: { sourceSegment: true }, orderBy: { ordinal: 'asc' },
        });
        const source = segments.map((segment) => segment.sourceSegment?.text ?? '');
        if (!source.length || source.some((text) => !text)) throw new Error('Canonical transcript is unavailable');
        return { translations: await this.translate(source, job.video.sourceLanguage, job.video.targetLanguage) };
      }
      case 'ASSIGN_CAST':
        return {};
      case 'EXPORT_SRT': {
        const segments = await this.prisma.videoSegment.findMany({
          where: { videoId: job.videoId }, include: { currentRevision: true }, orderBy: { ordinal: 'asc' },
        });
        if (!segments.length || segments.some((segment) => !segment.currentRevision)) throw new Error('Approved script is unavailable');
        const body = Buffer.from(segments.map((segment, index) => {
          const revision = segment.currentRevision!;
          return `${index + 1}\n${srtTime(revision.targetStartMs)} --> ${srtTime(revision.targetEndMs)}\n${revision.translatedText}\n`;
        }).join('\n'), 'utf8');
        const asset = await this.objects.putControlOutput(task.id, 'subtitles.srt', 'application/x-subrip', body);
        return { subtitleAssetId: asset.id };
      }
      default:
        throw new Error(`Unsupported Control Plane task: ${task.taskType}`);
    }
  }

  private succeed(task: PipelineTask, attemptId: string, result: TaskResult): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.pipelineTask.findUniqueOrThrow({ where: { id: task.id } });
      if (current.status !== 'RUNNING' || current.attemptCount !== task.attemptCount) return;
      const job = await tx.pipelineJob.findUniqueOrThrow({ where: { id: task.pipelineJobId } });
      if (task.taskType === 'MERGE_TRANSCRIPT') await materializeTranscript(tx, job.videoId, attemptId, result as TranscriptPayload);
      if (task.taskType === 'TRANSLATE') {
        await tx.pipelineTask.update({ where: { id: task.id }, data: { configuration: { kind: 'TRANSLATE', ...result } as Prisma.InputJsonValue } });
      }
      if (task.taskType === 'ASSIGN_CAST') await materializeSingleVoiceCast(tx, job.videoId, job.profileSnapshot, task.pipelineJobId);
      if (task.taskType === 'EXPORT_SRT') await linkSubtitle(tx, job.videoId, (result as { subtitleAssetId: string }).subtitleAssetId);
      const finishedAt = new Date();
      await tx.taskAttempt.update({ where: { id: attemptId }, data: { status: 'SUCCEEDED', finishedAt, metricsSafe: result as Prisma.InputJsonValue } });
      const completed = await tx.pipelineTask.update({ where: { id: task.id }, data: { status: 'SUCCEEDED', progressBps: 10_000, version: { increment: 1 } } });
      await this.orchestrator.unlockDependents(tx, completed.id);
      await this.orchestrator.refreshAggregateStatus(tx, completed.pipelineJobId);
      await controlEvent(tx, completed, attemptId, 'TASK_SUCCEEDED', 'RUNNING', 'SUCCEEDED');
    });
  }

  private fail(task: PipelineTask, attemptId: string, detail: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.pipelineTask.findUniqueOrThrow({ where: { id: task.id } });
      if (current.status !== 'RUNNING' || current.attemptCount !== task.attemptCount) return;
      const retry = current.attemptCount < current.maxAttempts;
      const finishedAt = new Date();
      await tx.taskAttempt.update({ where: { id: attemptId }, data: {
        status: 'FAILED', finishedAt, errorCode: 'CONTROL_PLANE_EXECUTION_FAILED', errorDetailSafe: detail,
      } });
      const failed = await tx.pipelineTask.update({ where: { id: task.id }, data: {
        status: retry ? 'READY' : 'FAILED', readyAt: retry ? new Date(Date.now() + RETRY_MS) : null,
        version: { increment: 1 },
      } });
      if (retry) {
        await tx.pipelineJob.update({ where: { id: task.pipelineJobId }, data: { status: 'RUNNING', version: { increment: 1 } } });
      } else {
        await tx.pipelineJob.update({ where: { id: task.pipelineJobId }, data: {
          status: 'FAILED', finishedAt, failureCode: 'CONTROL_PLANE_EXECUTION_FAILED', failureDetailSafe: detail, version: { increment: 1 },
        } });
        const job = await tx.pipelineJob.findUniqueOrThrow({ where: { id: task.pipelineJobId } });
        await tx.video.update({ where: { id: job.videoId }, data: { status: 'FAILED', version: { increment: 1 } } });
      }
      await controlEvent(tx, failed, attemptId, retry ? 'TASK_RETRY_SCHEDULED' : 'TASK_FAILED', 'RUNNING', retry ? 'READY' : 'FAILED');
    });
  }

  private async translate(source: string[], sourceLanguage: string, targetLanguage: string): Promise<string[]> {
    if (sourceLanguage.toLowerCase() === targetLanguage.toLowerCase()) return source;
    const settings = await this.prisma.systemSetting.findUnique({ where: { singletonKey: 'DEFAULT' }, include: { contentAgentCredential: true } });
    if (!settings?.contentAgentCredential) throw new Error('Content Agent credential is not configured');
    const credential = this.cipher.decrypt<{ apiKey: string }>({
      payload: settings.contentAgentCredential.encryptedPayload, keyVersion: settings.contentAgentCredential.keyVersion,
    });
    const prompt = `Translate each item from ${sourceLanguage} to ${targetLanguage}. Preserve order and meaning. Return only JSON with this exact shape: {"translations":["..."]}. Input: ${JSON.stringify(source)}`;
    const anthropic = settings.contentAgentProvider === 'ANTHROPIC';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(anthropic ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/responses', {
        method: 'POST', signal: controller.signal,
        headers: anthropic
          ? { 'content-type': 'application/json', 'x-api-key': credential.apiKey, 'anthropic-version': '2023-06-01' }
          : { 'content-type': 'application/json', authorization: `Bearer ${credential.apiKey}` },
        body: JSON.stringify(anthropic
          ? { model: settings.contentAgentModel, max_tokens: 8_000, messages: [{ role: 'user', content: prompt }] }
          : { model: settings.contentAgentModel, max_output_tokens: 8_000, input: prompt }),
      });
      if (!response.ok) throw new Error(`Content Agent returned HTTP ${response.status}`);
      const payload = await response.json() as Record<string, unknown>;
      const raw = anthropic ? object(array(payload.content)[0]).text : openAiText(payload);
      const parsed = JSON.parse(extractJson(text(raw))) as { translations?: unknown };
      const translated = array(parsed.translations);
      if (translated.length !== source.length || translated.some((item) => typeof item !== 'string' || !item.trim())) throw new Error('Content Agent returned an invalid translation count');
      return translated as string[];
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function materializeTranscript(tx: Prisma.TransactionClient, videoId: string, attemptId: string, payload: TranscriptPayload) {
  if (await tx.transcriptRun.findFirst({ where: { taskAttemptId: attemptId } })) return;
  const runId = uuidV7();
  const confidences = payload.segments.flatMap((segment) => segment.confidence === undefined ? [] : [segment.confidence]);
  await tx.transcriptRun.create({ data: {
    id: runId, videoId, method: 'ASR', status: 'SELECTED', language: (await tx.video.findUniqueOrThrow({ where: { id: videoId } })).sourceLanguage,
    modelName: 'faster-whisper', taskAttemptId: attemptId, selectedAt: new Date(),
    averageConfidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : null,
  } });
  for (const [index, segment] of payload.segments.entries()) {
    const transcriptSegmentId = uuidV7();
    await tx.transcriptSegment.create({ data: {
      id: transcriptSegmentId, transcriptRunId: runId, ordinal: index,
      startMs: segment.startMs, endMs: segment.endMs, text: segment.text,
      ...(segment.confidence === undefined ? {} : { confidence: segment.confidence }), metadata: {},
    } });
    await tx.videoSegment.create({ data: {
      id: uuidV7(), videoId, ordinal: index, sourceStartMs: segment.startMs,
      sourceEndMs: segment.endMs, sourceSegmentId: transcriptSegmentId,
    } });
  }
}

async function materializeSingleVoiceCast(tx: Prisma.TransactionClient, videoId: string, snapshotValue: Prisma.JsonValue, jobId: string) {
  const snapshot = snapshotValue as unknown as ProfileJobSnapshot;
  const translateTask = await tx.pipelineTask.findFirst({ where: { pipelineJobId: jobId, taskType: 'TRANSLATE', status: 'SUCCEEDED' } });
  const translations = array(object(translateTask?.configuration).translations);
  const segments = await tx.videoSegment.findMany({ where: { videoId }, include: { sourceSegment: true }, orderBy: { ordinal: 'asc' } });
  if (translations.length !== segments.length) throw new Error('Translation result does not match transcript');
  for (const [index, segment] of segments.entries()) {
    if (segment.currentRevisionId) continue;
    const id = uuidV7();
    await tx.segmentRevision.create({ data: {
      id, videoSegmentId: segment.id, revision: 1, sourceText: segment.sourceSegment!.text,
      translatedText: text(translations[index]), voiceProfileId: snapshot.defaultVoice.profileId,
      targetStartMs: segment.sourceStartMs, targetEndMs: segment.sourceEndMs,
    } });
    await tx.videoSegment.update({ where: { id: segment.id }, data: { currentRevisionId: id } });
  }
}

async function linkSubtitle(tx: Prisma.TransactionClient, videoId: string, assetId: string) {
  if (await tx.videoAsset.findFirst({ where: { videoId, kind: 'OUTPUT_SUBTITLE', assetId } })) return;
  const latest = await tx.videoAsset.aggregate({ where: { videoId, kind: 'OUTPUT_SUBTITLE' }, _max: { revision: true } });
  await tx.videoAsset.updateMany({ where: { videoId, kind: 'OUTPUT_SUBTITLE', isCurrent: true }, data: { isCurrent: false } });
  await tx.videoAsset.create({ data: { id: uuidV7(), videoId, assetId, kind: 'OUTPUT_SUBTITLE', revision: (latest._max.revision ?? 0) + 1, isCurrent: true } });
}

async function controlEvent(tx: Prisma.TransactionClient, task: PipelineTask, attemptId: string, eventType: string, fromStatus: string, toStatus: string) {
  const job = await tx.pipelineJob.findUniqueOrThrow({ where: { id: task.pipelineJobId } });
  await tx.workflowEvent.create({ data: {
    id: uuidV7(), videoId: job.videoId, pipelineJobId: job.id, pipelineTaskId: task.id,
    taskAttemptId: attemptId, eventType, fromStatus, toStatus, actorType: 'SYSTEM', payloadSafe: { taskVersion: task.version },
  } });
  await tx.outboxMessage.create({ data: {
    id: uuidV7(), aggregateType: 'PIPELINE_JOB', aggregateId: job.id, eventType: 'queue.invalidate',
    payloadSafe: { entity: 'TASK', jobId: job.id, videoId: job.videoId, taskId: task.id, reason: eventType },
  } });
}

function transcript(value: unknown): TranscriptPayload {
  const root = object(value);
  const segments = array(root.segments).map((value) => {
    const item = object(value); const startMs = item.startMs; const endMs = item.endMs; const body = item.text;
    if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || Number(startMs) < 0 || Number(endMs) <= Number(startMs) || typeof body !== 'string' || !body.trim()) throw new Error('ASR transcript schema is invalid');
    if (item.confidence !== undefined && (typeof item.confidence !== 'number' || item.confidence < 0 || item.confidence > 1)) throw new Error('ASR confidence is invalid');
    return { startMs: Number(startMs), endMs: Number(endMs), text: body.trim(), ...(typeof item.confidence === 'number' ? { confidence: item.confidence } : {}) };
  });
  if (!segments.length) throw new Error('ASR transcript has no segments');
  return { segments };
}

function openAiText(payload: Record<string, unknown>): unknown {
  if (typeof payload.output_text === 'string') return payload.output_text;
  for (const output of array(payload.output)) for (const content of array(object(output).content)) {
    const value = object(content).text; if (typeof value === 'string') return value;
  }
  return undefined;
}
function extractJson(value: string): string { const start = value.indexOf('{'); const end = value.lastIndexOf('}'); if (start < 0 || end <= start) throw new Error('Content Agent did not return JSON'); return value.slice(start, end + 1); }
function srtTime(ms: number): string { const hours = Math.floor(ms / 3_600_000); const minutes = Math.floor(ms % 3_600_000 / 60_000); const seconds = Math.floor(ms % 60_000 / 1_000); const millis = ms % 1_000; return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${String(millis).padStart(3, '0')}`; }
function pad(value: number): string { return String(value).padStart(2, '0'); }
function safeError(error: unknown): string { return (error instanceof Error ? error.message : 'Control Plane task failed').slice(0, 1_000); }
function object(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string { if (typeof value !== 'string' || !value.trim()) throw new Error('Expected non-empty text'); return value; }
