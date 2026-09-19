import type {
  GetLivenessData,
  GetReadinessData,
  ProblemDetails,
  SuccessEnvelope,
} from '@reup-dubbing-studio/api-client';

export const CONTROL_PLANE_BASE_URL = 'http://localhost:3000/v1';
export const LIVENESS_PATH = '/health/live' satisfies GetLivenessData['url'];
export const READINESS_PATH = '/health/ready' satisfies GetReadinessData['url'];

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
