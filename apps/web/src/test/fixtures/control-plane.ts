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
  output16x9Enabled: true, output9x16Enabled: false,
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
  overrides: { targetLanguage: null, defaultVoiceProfileId: null, voiceMode: null, subtitleLanguage: null, subtitleFilenameRule: null, subtitleMaxLineLength: null, ttsSpeed: 1.1, timingPolicy: null, output16x9Enabled: null, output9x16Enabled: true },
  effectiveConfig: { ...pipeline, ttsSpeed: 1.1, output9x16Enabled: true },
  inheritance: { targetLanguage: 'CHANNEL', defaultVoiceProfileId: 'CHANNEL', voiceMode: 'CHANNEL', subtitleLanguage: 'CHANNEL', subtitleFilenameRule: 'CHANNEL', subtitleMaxLineLength: 'CHANNEL', ttsSpeed: 'SERIES', timingPolicy: 'CHANNEL', output16x9Enabled: 'CHANNEL', output9x16Enabled: 'SERIES' },
  mask: { x: 0.1, y: 0.8, width: 0.8, height: 0.1 }, assets: [], readiness: 'READY', readinessIssues: [],
  version: 2, parentVersion: channelProfile.version, createdAt: '2026-09-19T08:00:00.000Z', updatedAt: '2026-09-20T09:00:00.000Z',
} satisfies SeriesProfile;

export const channelProfilesEnvelope = { data: { items: [channelProfile], nextCursor: null }, meta: { requestId: READY_REQUEST_ID } } satisfies ChannelProfileListEnvelope;
export const seriesProfilesEnvelope = { data: { items: [seriesProfile], nextCursor: null }, meta: { requestId: READY_REQUEST_ID } } satisfies SeriesProfileListEnvelope;
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
