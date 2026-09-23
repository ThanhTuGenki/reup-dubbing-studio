import type {
  GetLivenessData,
  GetReadinessData,
  ProblemDetails,
  SettingsEnvelope,
  SuccessEnvelope,
  ChannelProfile,
  ChannelProfileListEnvelope,
  SeriesProfile,
  SeriesProfileListEnvelope,
  VoiceProfile,
  VoiceProfileListEnvelope,
  SourceAccount,
  DiscoveryCategory,
  DiscoveryItem,
  Watchlist,
  QueueJob,
  QueueJobDetail,
  Worker,
  WorkerImage,
  ReviewPolicy,
  PublicationTask,
  PublicationTaskListEnvelope,
  DashboardEnvelope,
} from '@reup-dubbing-studio/api-client';

export const CONTROL_PLANE_BASE_URL = 'http://localhost:3000/v1';
export const LIVENESS_PATH = '/health/live' satisfies GetLivenessData['url'];
export const READINESS_PATH = '/health/ready' satisfies GetReadinessData['url'];
export const SETTINGS_PATH = '/settings' as const;

export const LIVE_REQUEST_ID = '0191f3d2-7f5b-7abc-8b2e-123456789abc';
export const READY_REQUEST_ID = '0191f3d2-7f5b-7abc-8b2e-123456789abd';

export const liveEnvelope = {
  data: { status: 'ok' },
  meta: { requestId: LIVE_REQUEST_ID },
} satisfies SuccessEnvelope;

export const readyEnvelope = {
  data: { status: 'ok' },
  meta: { requestId: READY_REQUEST_ID },
} satisfies SuccessEnvelope;

export const settingsEnvelope = {
  data: {
    version: 3,
    contentAgent: {
      provider: 'ANTHROPIC', model: 'claude-sonnet-5',
      credential: { configured: true, hint: '3f8a', rotatedAt: '2026-09-19T10:00:00.000Z' },
    },
    storage: {
      backend: 'R2', accountId: '8f3c00000000000000000000000000a4', bucket: 'reup-dubbing-media',
      credential: { configured: true, hint: 'K2M9', rotatedAt: '2026-09-19T10:00:00.000Z' },
    },
    retention: { rawVideoDays: 7, intermediateDays: 3, taskLogDays: 30, finalOutputDays: 90 },
  },
  meta: { requestId: READY_REQUEST_ID },
} satisfies SettingsEnvelope;

const pipeline = {
  targetLanguage: 'vi', defaultVoiceProfileId: '0191f3d2-7f5b-7abc-8b2e-123456789ae0',
  voiceMode: 'SINGLE' as const, subtitleLanguage: 'vi', subtitleFilenameRule: '{slug}.vi.srt',
  subtitleMaxLineLength: 42, ttsSpeed: 1, timingPolicy: 'FIT_SEGMENT' as const,
  removeHardSubEnabled: false, output16x9Enabled: true, output9x16Enabled: false,
};

export const channelProfile = {
  id: '0191f3d2-7f5b-7abc-8b2e-123456789ac0', name: 'Kênh Việt hóa', status: 'ACTIVE', pipeline,
  content: { voiceRules: {}, ctaTemplate: 'Theo dõi kênh', metadataTemplate: {}, baseKeywords: ['phim ngắn'] },
  destinations: [{ id: '0191f3d2-7f5b-7abc-8b2e-123456789ad0', platform: 'YOUTUBE', externalId: 'UC-demo', displayName: 'Kênh Việt hóa', isRequired: true, isActive: true, platformConfig: {}, version: 1 }],
  assets: [], readiness: 'READY', readinessIssues: [], version: 3,
  createdAt: '2026-09-18T08:00:00.000Z', updatedAt: '2026-09-20T08:00:00.000Z',
} satisfies ChannelProfile;

export const seriesProfile = {
  id: '0191f3d2-7f5b-7abc-8b2e-123456789ac1', channelProfileId: channelProfile.id,
  name: 'Tổng tài tập ngắn', status: 'ACTIVE',
  overrides: { targetLanguage: null, defaultVoiceProfileId: null, voiceMode: null, subtitleLanguage: null, subtitleFilenameRule: null, subtitleMaxLineLength: null, ttsSpeed: 1.1, timingPolicy: null, removeHardSubEnabled: null, output16x9Enabled: null, output9x16Enabled: true },
  effectiveConfig: { ...pipeline, ttsSpeed: 1.1, output9x16Enabled: true },
  inheritance: { targetLanguage: 'CHANNEL', defaultVoiceProfileId: 'CHANNEL', voiceMode: 'CHANNEL', subtitleLanguage: 'CHANNEL', subtitleFilenameRule: 'CHANNEL', subtitleMaxLineLength: 'CHANNEL', ttsSpeed: 'SERIES', timingPolicy: 'CHANNEL', removeHardSubEnabled: 'CHANNEL', output16x9Enabled: 'CHANNEL', output9x16Enabled: 'SERIES' },
  mask: { x: 0.1, y: 0.8, width: 0.8, height: 0.1 }, assets: [], readiness: 'READY', readinessIssues: [],
  version: 2, parentVersion: channelProfile.version, createdAt: '2026-09-19T08:00:00.000Z', updatedAt: '2026-09-20T09:00:00.000Z',
} satisfies SeriesProfile;

export const channelProfilesEnvelope = { data: { items: [channelProfile], nextCursor: null }, meta: { requestId: READY_REQUEST_ID } } satisfies ChannelProfileListEnvelope;
export const seriesProfilesEnvelope = { data: { items: [seriesProfile], nextCursor: null }, meta: { requestId: READY_REQUEST_ID } } satisfies SeriesProfileListEnvelope;
export const channelReviewPolicy = {
  ownerType: 'CHANNEL', ownerProfileId: channelProfile.id,
  stored: { castGate: 'NOT_REQUIRED', scriptGate: 'MANUAL_REQUIRED', ttsGate: 'MANUAL_REQUIRED', renderGate: 'MANUAL_REQUIRED', publishContentGate: 'MANUAL_REQUIRED', autoRequestRender: false },
  effective: { castGate: 'NOT_REQUIRED', scriptGate: 'MANUAL_REQUIRED', ttsGate: 'MANUAL_REQUIRED', renderGate: 'MANUAL_REQUIRED', publishContentGate: 'MANUAL_REQUIRED', autoRequestRender: false },
  inheritance: { castGate: 'CHANNEL', scriptGate: 'CHANNEL', ttsGate: 'CHANNEL', renderGate: 'CHANNEL', publishContentGate: 'CHANNEL', autoRequestRender: 'CHANNEL' },
  version: 2, parentPolicyVersion: null, updatedAt: '2026-09-20T09:00:00.000Z',
} satisfies ReviewPolicy;
export const seriesReviewPolicy = {
  ownerType: 'SERIES', ownerProfileId: seriesProfile.id,
  stored: { castGate: null, scriptGate: 'NOT_REQUIRED', ttsGate: null, renderGate: null, publishContentGate: null, autoRequestRender: null },
  effective: { ...channelReviewPolicy.effective, scriptGate: 'NOT_REQUIRED' },
  inheritance: { castGate: 'CHANNEL', scriptGate: 'SERIES', ttsGate: 'CHANNEL', renderGate: 'CHANNEL', publishContentGate: 'CHANNEL', autoRequestRender: 'CHANNEL' },
  version: 3, parentPolicyVersion: channelReviewPolicy.version, updatedAt: '2026-09-20T09:30:00.000Z',
} satisfies ReviewPolicy;
export const voiceProfile = {
  id: '0191f3d2-7f5b-7abc-8b2e-123456789ae0', name: 'Giọng kể ấm', primaryLanguage: 'vi',
  description: 'Giọng kể phim ngắn', tags: ['ấm', 'kể chuyện'], status: 'READY', licenseKind: 'OWNED_RECORDING',
  licenseReference: null, sourceReference: 'Studio nội bộ', commercialUseAllowed: true,
  samples: [{ id: '0191f3d2-7f5b-7abc-8b2e-123456789ae1', assetId: '0191f3d2-7f5b-7abc-8b2e-123456789ae2', language: 'vi', transcript: 'Xin chào khán giả', durationMs: 5000, fileName: 'voice.wav', contentType: 'audio/wav', byteSize: '128', revision: 1 }],
  readiness: 'READY', readinessIssues: [], referencedBy: { channelProfiles: 1, seriesProfiles: 0 }, version: 3,
  createdAt: '2026-09-18T08:00:00.000Z', updatedAt: '2026-09-20T08:00:00.000Z',
} satisfies VoiceProfile;
export const voiceProfilesEnvelope = { data: { items: [voiceProfile], nextCursor: null }, meta: { requestId: READY_REQUEST_ID } } satisfies VoiceProfileListEnvelope;
export const sourceAccount = { id: '0191f3d2-7f5b-7abc-8b2e-123456789af0', platform: 'DOUYIN', displayName: 'Douyin chính', status: 'ACTIVE', credential: { kind: 'NETSCAPE_COOKIE', importedAt: '2026-09-20T08:00:00.000Z', expiresAt: null }, lastValidatedAt: '2026-09-20T08:00:00.000Z', lastSuccessAt: '2026-09-20T08:00:00.000Z', consecutiveFailures: 0, cooldownUntil: null, version: 2, createdAt: '2026-09-20T07:00:00.000Z', updatedAt: '2026-09-20T08:00:00.000Z' } satisfies SourceAccount;
export const discoveryCategory = { id: '0191f3d2-7f5b-7abc-8b2e-123456789af1', platform: 'DOUYIN', externalKey: '300213', slug: 'knowledge', label: 'Kiến thức', kind: 'JINGXUAN_CATEGORY', parentId: null } satisfies DiscoveryCategory;
export const discoveryItem = { id: '0191f3d2-7f5b-7abc-8b2e-123456789af2', runId: '0191f3d2-7f5b-7abc-8b2e-123456789af3', rank: 1, discoveredAt: '2026-09-20T08:30:00.000Z', sourceContent: { id: '0191f3d2-7f5b-7abc-8b2e-123456789af4', platform: 'DOUYIN', externalId: '999999999999999999', contentType: 'VIDEO', title: 'Mẹo học tiếng Trung', description: 'Dữ liệu mẫu Discovery', canonicalUrl: 'https://www.douyin.com/video/999999999999999999', publishedAt: '2026-09-19T08:30:00.000Z', durationMs: 45000, width: 1080, height: 1920, availability: 'AVAILABLE', ingestEligible: true, firstSeenAt: '2026-09-20T08:30:00.000Z', lastSeenAt: '2026-09-20T08:30:00.000Z', creator: { id: '0191f3d2-7f5b-7abc-8b2e-123456789af5', externalId: 'creator-1', nickname: 'Học mỗi ngày', profileUrl: 'https://www.douyin.com/user/creator-1' }, categories: [discoveryCategory], cover: { url: 'https://p.douyin.com/cover.jpg?size=large', requiresRefresh: false }, metrics: { capturedAt: '2026-09-20T08:30:00.000Z', playCount: '120000', diggCount: '4500', commentCount: null, collectCount: null, shareCount: null } } } satisfies DiscoveryItem;
export const discoveryWatchlist = { id: '0191f3d2-7f5b-7abc-8b2e-123456789af6', sourceAccountId: sourceAccount.id, mode: 'CREATOR', resolvedInput: { url: 'https://www.douyin.com/user/creator-1' }, displayName: 'Học mỗi ngày', status: 'ACTIVE', scheduleIntervalMin: 60, nextRunAt: '2026-09-20T10:00:00.000Z', lastRunAt: '2026-09-20T08:00:00.000Z', lastSuccessAt: '2026-09-20T08:05:00.000Z', consecutiveFailures: 0, version: 1, createdAt: '2026-09-19T08:00:00.000Z', updatedAt: '2026-09-20T08:05:00.000Z' } satisfies Watchlist;
export const ingestVideoId = '0191f3d2-7f5b-7abc-8b2e-123456789af7';
export const ingestJobId = '0191f3d2-7f5b-7abc-8b2e-123456789af8';
export const ingestTaskId = '0191f3d2-7f5b-7abc-8b2e-123456789af9';
export const ingestPreflightEnvelope = {
  data: {
    summary: { total: 1, ready: 1, blocked: 0 },
    items: [{ sourceContentId: discoveryItem.sourceContent.id, disposition: 'READY', existingVideoId: null, existingJobId: null, issues: [] }],
  },
  meta: { requestId: READY_REQUEST_ID },
};
export const ingestCreateEnvelope = {
  data: {
    summary: { total: 1, created: 1, reused: 0, skipped: 0 },
    items: [{ sourceContentId: discoveryItem.sourceContent.id, result: 'CREATED', videoId: ingestVideoId, jobId: ingestJobId, taskId: ingestTaskId, jobStatus: 'QUEUED', videoStatus: 'INGEST_QUEUED', issues: [] }],
  },
  meta: { requestId: READY_REQUEST_ID },
};
export const queueTask = { id: ingestTaskId, taskType: 'DOWNLOAD', resourceClass: 'IO', status: 'READY' as const, progressPercent: 25, progressDetail: 'Đang chuẩn bị tải', attemptCount: 0, maxAttempts: 3, readyAt: '2026-09-20T08:31:00.000Z', version: 1, createdAt: '2026-09-20T08:31:00.000Z', updatedAt: '2026-09-20T08:32:00.000Z' };
export const queueJob = { id: ingestJobId, videoId: ingestVideoId, kind: 'INGEST' as const, status: 'QUEUED' as const, version: 1, title: 'Video Queue mẫu', channelProfileId: channelProfile.id, channelProfileName: channelProfile.name, seriesProfileId: null, seriesProfileName: null, currentTask: queueTask, progress: { percent: 25, completedTasks: 0, totalTasks: 1 }, failure: null, actions: { canRetry: false, canCancel: true }, startedAt: null, finishedAt: null, createdAt: '2026-09-20T08:31:00.000Z', updatedAt: '2026-09-20T08:32:00.000Z' } satisfies QueueJob;
export const queueJobDetail = { ...queueJob, tasks: [queueTask], timeline: [] } satisfies QueueJobDetail;
export const queueListEnvelope = { data: { items: [queueJob], nextCursor: null }, meta: { requestId: READY_REQUEST_ID } };
export const queueDetailEnvelope = { data: queueJobDetail, meta: { requestId: READY_REQUEST_ID } };

export const publicationTask = {
  id: '0191f3d2-7f5b-7abc-8b2e-123456789c01', packageId: '0191f3d2-7f5b-7abc-8b2e-123456789c02', videoId: ingestVideoId,
  destinationId: channelProfile.destinations[0]!.id, renderOutputId: '0191f3d2-7f5b-7abc-8b2e-123456789c03', platform: 'YOUTUBE', destinationName: 'YouTube Việt hóa',
  status: 'CONTENT_GENERATED', isRequired: true, scheduledAt: '2026-09-23T02:00:00.000Z', deadlineAt: '2026-09-23T03:00:00.000Z', version: 3, updatedAt: '2026-09-22T10:00:00.000Z',
  notes: 'Kiểm tra visibility trước khi đăng', publishedAt: null,
  contentSubjectVersion: 'publication-task:test:fields:test',
  fields: [
    { id: '0191f3d2-7f5b-7abc-8b2e-123456789c04', key: 'title', isLocked: false, version: 1, currentRevision: { id: '0191f3d2-7f5b-7abc-8b2e-123456789c05', revision: 1, value: 'Tiêu đề YouTube mẫu', origin: 'USER_EDITED', createdAt: '2026-09-22T09:00:00.000Z' }, revisions: [{ id: '0191f3d2-7f5b-7abc-8b2e-123456789c05', revision: 1, value: 'Tiêu đề YouTube mẫu', origin: 'USER_EDITED', createdAt: '2026-09-22T09:00:00.000Z' }] },
    { id: '0191f3d2-7f5b-7abc-8b2e-123456789c06', key: 'description', isLocked: false, version: 1, currentRevision: { id: '0191f3d2-7f5b-7abc-8b2e-123456789c07', revision: 1, value: 'Mô tả video mẫu', origin: 'USER_EDITED', createdAt: '2026-09-22T09:00:00.000Z' }, revisions: [{ id: '0191f3d2-7f5b-7abc-8b2e-123456789c07', revision: 1, value: 'Mô tả video mẫu', origin: 'USER_EDITED', createdAt: '2026-09-22T09:00:00.000Z' }] },
  ],
  checklist: [{ id: '0191f3d2-7f5b-7abc-8b2e-123456789c08', key: 'uploadVideo', label: 'Tải video lên', isRequired: true, status: 'PENDING', ordinal: 0, completedAt: null }],
  proofs: [], siblingTasks: [], assetAvailability: { VIDEO: true, SUBTITLE: true, THUMBNAIL: false },
} satisfies PublicationTask;
export const publicationListEnvelope = { data: { items: [{ id: publicationTask.id, packageId: publicationTask.packageId, videoId: publicationTask.videoId, destinationId: publicationTask.destinationId, renderOutputId: publicationTask.renderOutputId, platform: publicationTask.platform, destinationName: publicationTask.destinationName, status: publicationTask.status, isRequired: publicationTask.isRequired, scheduledAt: publicationTask.scheduledAt, deadlineAt: publicationTask.deadlineAt, version: publicationTask.version, updatedAt: publicationTask.updatedAt }], nextCursor: null }, meta: { requestId: READY_REQUEST_ID } } satisfies PublicationTaskListEnvelope;
export const publicationDetailEnvelope = { data: publicationTask, meta: { requestId: READY_REQUEST_ID } };

export const dashboardEnvelope = {
  data: {
    generatedAt: '2026-09-23T03:30:00.000Z',
    timezone: 'Asia/Ho_Chi_Minh',
    videos: {
      countsByStatus: { INGEST_QUEUED: 2, INGESTING: 1, INGESTED: 4, PROCESSING: 3, AWAITING_REVIEW: 5, READY_TO_PUBLISH: 6, PUBLISHED: 18, FAILED: 1, ARCHIVED: 2 },
      processing: 3, awaitingReview: 5, readyToPublish: 6, published: 18, failed: 1, totalActive: 22,
    },
    queue: { active: 7, running: 4, waitingForGpu: 2, failed: 1 },
    publishing: { upcoming: 3, overdue: 1, awaitingProof: 2, awaitingVerification: 1, needsRevision: 1 },
    workers: { online: 2, busy: 1, safeToTerminate: 1, unhealthy: 0, activeLeases: 2 },
    cost: { openBillingSessions: 2, estimatedCostCp: '13000.000000', estimatedCostVnd: '13000.00', vndCoverage: 'COMPLETE' },
    attention: {
      total: 2,
      items: [
        { id: 'attention:queue:1', code: 'QUEUE_WAITING_FOR_GPU', severity: 'WARNING', title: 'Job đang chờ GPU', detail: 'Job đã chờ capacity hơn 15 phút.', entityType: 'PIPELINE_JOB', entityId: ingestJobId, occurredAt: '2026-09-23T03:00:00.000Z', dueAt: null, href: '/queue' },
        { id: 'attention:publishing:1', code: 'PUBLICATION_OVERDUE', severity: 'CRITICAL', title: 'Lịch đăng đã quá hạn', detail: 'Một publication task cần được xử lý ngay.', entityType: 'PUBLICATION_TASK', entityId: publicationTask.id, occurredAt: '2026-09-23T02:00:00.000Z', dueAt: '2026-09-23T03:00:00.000Z', href: '/publishing' },
      ],
    },
    recentActivity: {
      items: [
        { id: 'activity:queue:1', kind: 'QUEUE_EVENT', title: 'Job bắt đầu xử lý', detail: 'Video Queue mẫu', entityType: 'PIPELINE_JOB', entityId: ingestJobId, occurredAt: '2026-09-23T03:20:00.000Z', href: '/queue' },
        { id: 'activity:proof:1', kind: 'PUBLICATION_PROOF_SUBMITTED', title: 'Đã gửi bằng chứng đăng bài', detail: 'YouTube Việt hóa', entityType: 'PUBLICATION_TASK', entityId: publicationTask.id, occurredAt: '2026-09-23T03:10:00.000Z', href: '/publishing' },
      ],
    },
  },
  meta: { requestId: READY_REQUEST_ID },
} satisfies DashboardEnvelope;

export const workerImage = {
  id: '0191f3d2-7f5b-7abc-8b2e-123456789b01', role: 'BATCH_MEDIA', semanticVersion: '1.8.2',
  imageDigest: `sha256:${'a'.repeat(64)}`, registryRef: 'ghcr.io/reup/media-worker@sha256:aaaa', contractVersion: 1,
  capabilities: ['media.render.ffmpeg.v1'],
  status: 'ACTIVE', approvedAt: '2026-09-20T07:00:00.000Z', revokedAt: null, version: 1,
} satisfies WorkerImage;
export const ttsWorkerImage = { ...workerImage, id: '0191f3d2-7f5b-7abc-8b2e-123456789b02', role: 'INTERACTIVE_TTS', semanticVersion: '0.9.4', registryRef: 'ghcr.io/reup/tts-worker@sha256:bbbb', imageDigest: `sha256:${'b'.repeat(64)}`, capabilities: ['tts.omnivoice.v1'] } satisfies WorkerImage;
export const gpuWorker = {
  id: '0191f3d2-7f5b-7abc-8b2e-123456789b03', displayName: 'batch-a100-01', role: 'BATCH_MEDIA', provider: 'EzyCloudX', providerInstanceId: 'ctr-77aa02', mode: 'MANUAL_REGISTERED',
  desiredStatus: 'ACTIVE', observedStatus: 'BUSY', expectedGpuModel: 'NVIDIA A100', expectedVramMb: 24576, approvedImage: workerImage,
  currentSession: { id: '0191f3d2-7f5b-7abc-8b2e-123456789b04', sessionNonce: '0191f3d2-7f5b-7abc-8b2e-123456789b05', imageDigest: workerImage.imageDigest, agentVersion: '1.8.2', contractVersion: 1, capabilities: workerImage.capabilities, gpuInventory: [{ model: 'NVIDIA A100', vramMb: 24576 }], cpuInventory: { cores: 16 }, capacity: { totalSlots: 4, availableSlots: 2 }, telemetry: { gpuUtilPercent: 52, temperatureC: 63 }, currentTaskCount: 2, lastHeartbeatSequence: '42', startedAt: '2026-09-20T08:00:00.000Z', lastHeartbeatAt: new Date().toISOString() },
  activeLeaseCount: 2, safeToTerminate: false, billing: { hourlyRateCp: '6500', paidVndPerCp: '1', billingStartedAt: '2026-09-20T08:00:00.000Z', estimatedCostCp: '13000' }, lastError: null, version: 3,
  createdAt: '2026-09-20T07:50:00.000Z', updatedAt: '2026-09-20T09:00:00.000Z',
} satisfies Worker;
export const safeWorker = { ...gpuWorker, id: '0191f3d2-7f5b-7abc-8b2e-123456789b06', displayName: 'batch-l40-safe', desiredStatus: 'DRAINING', observedStatus: 'SAFE_TO_TERMINATE', activeLeaseCount: 0, safeToTerminate: true, version: 5 } satisfies Worker;
export const workerListEnvelope = { data: { items: [gpuWorker, safeWorker], nextCursor: null }, meta: { requestId: READY_REQUEST_ID } };
export const workerImagesEnvelope = { data: { items: [workerImage, ttsWorkerImage], nextCursor: null }, meta: { requestId: READY_REQUEST_ID } };

export function createProblemDetails(
  overrides: Partial<ProblemDetails> = {},
): ProblemDetails {
  return {
    type: 'about:blank',
    title: 'Control Plane unavailable',
    status: 503,
    instance: READINESS_PATH,
    code: 'INTERNAL_ERROR',
    requestId: READY_REQUEST_ID,
    ...overrides,
  };
}
