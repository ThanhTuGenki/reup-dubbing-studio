import type {
  GetLivenessData,
  GetReadinessData,
  ProblemDetails,
  SettingsEnvelope,
  SuccessEnvelope,
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
