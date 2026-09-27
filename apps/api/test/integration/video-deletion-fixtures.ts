import type { PipelineJobStatus, PrismaClient } from '@prisma/client';
import { uuidV7 } from '../../src/platform/ids/uuid-v7';

export type SeededVideo = Awaited<ReturnType<typeof seedVideoTree>>;
type Options = { jobStatus?: PipelineJobStatus; withProof?: boolean; pendingOutput?: boolean; sharedWithChannel?: boolean };

/** One local video with every child table the deletion must clear, plus a channel voice sample and asset that must survive. */
export async function seedVideoTree(prisma: PrismaClient, options: Options = {}) {
  const ids = { user: uuidV7(), channel: uuidV7(), voice: uuidV7(), video: uuidV7(), job: uuidV7(), task: uuidV7(), attempt: uuidV7(), lease: uuidV7(), run: uuidV7(), transcriptSegment: uuidV7(), segment: uuidV7(), revision: uuidV7(), destination: uuidV7(), pkg: uuidV7(), pubTask: uuidV7(), field: uuidV7(), fieldRevision: uuidV7(), renderOutput: uuidV7() };
  const asset = { raw: uuidV7(), transcript: uuidV7(), audio: uuidV7(), output: uuidV7(), pending: uuidV7(), voiceSample: uuidV7(), channelAsset: uuidV7() };
  const active = ['QUEUED', 'RUNNING', 'WAITING_FOR_GPU', 'WAITING_FOR_REVIEW'].includes(options.jobStatus ?? 'SUCCEEDED');
  const now = new Date();
  await prisma.user.create({ data: { id: ids.user, displayName: 'Video deletion test user' } });
  await prisma.voiceProfile.create({ data: { id: ids.voice, name: `Deletion voice ${ids.voice}`, normalizedName: `deletion-voice-${ids.voice}`, primaryLanguage: 'vi', status: 'READY' } });
  await prisma.channelProfile.create({ data: { id: ids.channel, name: `Deletion channel ${ids.channel}`, normalizedName: `deletion-channel-${ids.channel}`, status: 'ACTIVE', targetLanguage: 'vi', subtitleLanguage: 'vi', subtitleFilenameRule: '{slug}.srt' } });
  const r2 = (id: string, status: 'AVAILABLE' | 'PENDING' = 'AVAILABLE', createdByAttemptId: string | null = null) => ({ id, storageBackend: 'R2' as const, bucket: 'test-bucket', objectKey: `videos/${ids.video}/${id}`, fileName: `${id}.bin`, status, byteSize: 10n, createdByAttemptId });
  await prisma.asset.createMany({ data: [r2(asset.raw), r2(asset.voiceSample), r2(asset.channelAsset)] });
  await prisma.voiceProfileSample.create({ data: { id: uuidV7(), voiceProfileId: ids.voice, assetId: asset.voiceSample, language: 'vi', transcript: 'mẫu', durationMs: 5_000, revision: 1 } });
  await prisma.channelProfileAsset.create({ data: { id: uuidV7(), channelProfileId: ids.channel, assetId: asset.channelAsset, role: 'LOGO', revision: 1 } });
  await prisma.video.create({ data: { id: ids.video, sourceKind: 'LOCAL_UPLOAD', localSourceMetadata: { durationMs: 1_000 }, channelProfileId: ids.channel, status: active ? 'PROCESSING' : 'READY_TO_PUBLISH', sourceLanguage: 'zh', targetLanguage: 'vi', displayTitle: 'Video sẽ bị xóa', createdById: ids.user } });
  await prisma.pipelineJob.create({ data: { id: ids.job, videoId: ids.video, kind: 'FULL_PIPELINE', status: options.jobStatus ?? 'SUCCEEDED', pipelineVersion: 'video-deletion-test', profileSnapshot: {}, requestedOutputs: {}, tasks: { create: { id: ids.task, taskType: 'RENDER', resourceClass: 'GPU_BATCH', status: active ? 'RUNNING' : 'SUCCEEDED', inputManifest: {} } } } });
  await prisma.taskAttempt.create({ data: { id: ids.attempt, pipelineTaskId: ids.task, attemptNumber: 1, executorKind: 'CONTROL_PLANE', executorInstanceId: 'deletion-test', status: active ? 'STARTED' : 'SUCCEEDED', startedAt: now } });
  await prisma.taskLease.create({ data: { id: ids.lease, pipelineTaskId: ids.task, taskAttemptId: ids.attempt, executorKind: 'CONTROL_PLANE', executorInstanceId: 'deletion-test', fencingToken: 1n, leasedAt: now, renewedAt: now, expiresAt: new Date(now.getTime() + 60_000), ...(active ? {} : { releasedAt: now, releaseReason: 'COMPLETED' }) } });
  await prisma.asset.createMany({ data: [r2(asset.transcript, 'AVAILABLE', ids.attempt), r2(asset.audio, 'AVAILABLE', ids.attempt), r2(asset.output, 'AVAILABLE', ids.attempt), ...(options.pendingOutput ? [r2(asset.pending, 'PENDING', ids.attempt)] : [])] });
  if (options.sharedWithChannel) await prisma.channelProfileAsset.create({ data: { id: uuidV7(), channelProfileId: ids.channel, assetId: asset.output, role: 'INTRO', revision: 1 } });
  await prisma.workflowEvent.create({ data: { id: uuidV7(), videoId: ids.video, pipelineJobId: ids.job, pipelineTaskId: ids.task, taskAttemptId: ids.attempt, eventType: 'TASK_STARTED', actorType: 'SYSTEM' } });
  await prisma.transcriptRun.create({ data: { id: ids.run, videoId: ids.video, method: 'ASR', status: 'SELECTED', language: 'zh', taskAttemptId: ids.attempt, rawAssetId: asset.transcript, segments: { create: { id: ids.transcriptSegment, ordinal: 0, startMs: 0, endMs: 1_000, text: '你好' } } } });
  await prisma.videoSegment.create({ data: { id: ids.segment, videoId: ids.video, ordinal: 0, sourceStartMs: 0, sourceEndMs: 1_000, sourceSegmentId: ids.transcriptSegment } });
  await prisma.segmentRevision.create({ data: { id: ids.revision, videoSegmentId: ids.segment, revision: 1, sourceText: '你好', translatedText: 'Xin chào', voiceProfileId: ids.voice, targetStartMs: 0, targetEndMs: 1_000 } });
  await prisma.videoSegment.update({ where: { id: ids.segment }, data: { currentRevisionId: ids.revision } });
  await prisma.segmentAudioRevision.create({ data: { id: uuidV7(), videoSegmentId: ids.segment, segmentRevisionId: ids.revision, assetId: asset.audio, taskAttemptId: ids.attempt, revision: 1, modelName: 'omnivoice', modelVersion: '1', targetDurationMs: 1_000, status: 'SELECTED' } });
  const rawLink = uuidV7(); const outputLink = uuidV7();
  await prisma.videoAsset.createMany({ data: [{ id: rawLink, videoId: ids.video, assetId: asset.raw, kind: 'RAW' }, { id: outputLink, videoId: ids.video, assetId: asset.output, kind: 'OUTPUT_VIDEO', variantKey: 'FULL_16X9' }] });
  await prisma.renderOutput.create({ data: { id: ids.renderOutput, videoId: ids.video, pipelineJobId: ids.job, variant: 'FULL_16X9', videoAssetId: outputLink, status: 'READY' } });
  await prisma.reviewDecision.create({ data: { id: uuidV7(), videoId: ids.video, pipelineJobId: ids.job, scope: 'RENDER', subjectVersion: '1', decision: 'APPROVED', decidedBy: ids.user } });
  await prisma.publishingDestination.create({ data: { id: ids.destination, channelProfileId: ids.channel, platform: 'YOUTUBE', displayName: 'Kênh test', normalizedName: `kenh-test-${ids.destination}` } });
  await prisma.publishPackage.create({ data: { id: ids.pkg, videoId: ids.video, channelProfileId: ids.channel, contextSnapshot: {}, rulesVersion: '1', revision: 1, createdBy: ids.user } });
  await prisma.publicationTask.create({ data: { id: ids.pubTask, publishPackageId: ids.pkg, destinationId: ids.destination, renderOutputId: ids.renderOutput, destinationSnapshot: {} } });
  await prisma.publicationField.create({ data: { id: ids.field, publicationTaskId: ids.pubTask, fieldKey: 'title' } });
  await prisma.publicationFieldRevision.create({ data: { id: ids.fieldRevision, publicationFieldId: ids.field, revision: 1, valueText: 'Tiêu đề', origin: 'GENERATED', createdBy: ids.user } });
  await prisma.publicationField.update({ where: { id: ids.field }, data: { currentRevisionId: ids.fieldRevision } });
  await prisma.publicationChecklistItem.create({ data: { id: uuidV7(), publicationTaskId: ids.pubTask, itemKey: 'title', labelSnapshot: 'Tiêu đề', isRequired: true, ordinal: 0 } });
  if (options.withProof) await prisma.publicationProof.create({ data: { id: uuidV7(), publicationTaskId: ids.pubTask, attemptNumber: 1, contentSnapshot: {}, submittedBy: ids.user } });
  return { ids, asset, videoAssetIds: [asset.raw, asset.transcript, asset.audio, asset.output, ...(options.pendingOutput ? [asset.pending] : [])] };
}

/** Removes whatever is left of a seeded tree, whether or not deletion ran. */
export async function cleanupVideoTree(prisma: PrismaClient, seeded: SeededVideo) {
  const { ids, asset } = seeded;
  const tasks = [ids.task]; const attempts = [ids.attempt];
  await prisma.publicationField.updateMany({ where: { id: ids.field }, data: { currentRevisionId: null } });
  await prisma.publicationProof.deleteMany({ where: { publicationTaskId: ids.pubTask } });
  await prisma.publicationFieldRevision.deleteMany({ where: { publicationFieldId: ids.field } });
  await prisma.publicationField.deleteMany({ where: { id: ids.field } });
  await prisma.publicationChecklistItem.deleteMany({ where: { publicationTaskId: ids.pubTask } });
  await prisma.publicationTask.deleteMany({ where: { id: ids.pubTask } });
  await prisma.publishPackage.deleteMany({ where: { id: ids.pkg } });
  await prisma.publishingDestination.deleteMany({ where: { id: ids.destination } });
  await prisma.renderOutput.deleteMany({ where: { videoId: ids.video } });
  await prisma.reviewDecision.deleteMany({ where: { videoId: ids.video } });
  await prisma.segmentAudioRevision.deleteMany({ where: { videoSegmentId: ids.segment } });
  await prisma.videoSegment.updateMany({ where: { videoId: ids.video }, data: { currentRevisionId: null } });
  await prisma.segmentRevision.deleteMany({ where: { videoSegmentId: ids.segment } });
  await prisma.videoSegment.deleteMany({ where: { videoId: ids.video } });
  await prisma.transcriptSegment.deleteMany({ where: { transcriptRunId: ids.run } });
  await prisma.transcriptRun.deleteMany({ where: { videoId: ids.video } });
  await prisma.videoAsset.deleteMany({ where: { videoId: ids.video } });
  await prisma.workflowEvent.deleteMany({ where: { OR: [{ videoId: ids.video }, { pipelineJobId: ids.job }] } });
  await prisma.outboxMessage.deleteMany({ where: { aggregateId: ids.job } });
  await prisma.taskLease.deleteMany({ where: { pipelineTaskId: { in: tasks } } });
  await prisma.channelProfileAsset.deleteMany({ where: { channelProfileId: ids.channel } });
  await prisma.voiceProfileSample.deleteMany({ where: { voiceProfileId: ids.voice } });
  await prisma.asset.deleteMany({ where: { id: { in: Object.values(asset) } } });
  await prisma.taskAttempt.deleteMany({ where: { id: { in: attempts } } });
  await prisma.pipelineTask.deleteMany({ where: { id: { in: tasks } } });
  await prisma.pipelineJob.deleteMany({ where: { videoId: ids.video } });
  await prisma.video.deleteMany({ where: { id: ids.video } });
  await prisma.channelProfile.deleteMany({ where: { id: ids.channel } });
  await prisma.voiceProfile.deleteMany({ where: { id: ids.voice } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
}
