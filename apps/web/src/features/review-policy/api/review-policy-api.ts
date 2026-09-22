import {
  createClient,
  getChannelReviewPolicy,
  getSeriesReviewPolicy,
  updateChannelReviewPolicy,
  updateSeriesReviewPolicy,
  type ReviewPolicy,
  type ReviewPolicyEnvelope,
  type UpdateChannelReviewPolicy,
  type UpdateSeriesReviewPolicy,
} from '@reup-dubbing-studio/api-client';

import { getSafeRequestId } from '@/shared/api/problem-details';
import { readRuntimeConfig } from '@/shared/config/runtime-config';

export type ReviewPolicyOwner = 'channel' | 'series';
export type ReviewPolicySnapshot = { policy: ReviewPolicy; etag: string };

export class ReviewPolicyApiError extends Error {
  override readonly name = 'ReviewPolicyApiError';
  constructor(message: string, readonly code?: string, readonly requestId?: string) { super(message); }
}

function client() { return createClient({ baseUrl: readRuntimeConfig().controlPlaneUrl }); }

export async function fetchReviewPolicy(owner: ReviewPolicyOwner, profileId: string, signal?: AbortSignal): Promise<ReviewPolicySnapshot> {
  const compatibleSignal = requestSignal(signal);
  const result = owner === 'channel'
    ? await getChannelReviewPolicy({ client: client(), path: { channelProfileId: profileId }, ...(compatibleSignal ? { signal: compatibleSignal } : {}) })
    : await getSeriesReviewPolicy({ client: client(), path: { seriesProfileId: profileId }, ...(compatibleSignal ? { signal: compatibleSignal } : {}) });
  return snapshot(result, owner, 'Không thể tải chính sách duyệt.');
}

function requestSignal(signal: AbortSignal | undefined): AbortSignal | undefined {
  if (!signal) return undefined;
  try { new Request('about:blank', { signal }); return signal; } catch { return undefined; }
}

export async function saveReviewPolicy(input: {
  owner: ReviewPolicyOwner;
  profileId: string;
  etag: string;
  idempotencyKey: string;
  patch: UpdateChannelReviewPolicy | UpdateSeriesReviewPolicy;
}): Promise<ReviewPolicySnapshot> {
  const result = input.owner === 'channel'
    ? await updateChannelReviewPolicy({
      client: client(), path: { channelProfileId: input.profileId }, body: input.patch as UpdateChannelReviewPolicy,
      headers: { 'If-Match': input.etag, 'Idempotency-Key': input.idempotencyKey },
    })
    : await updateSeriesReviewPolicy({
      client: client(), path: { seriesProfileId: input.profileId }, body: input.patch as UpdateSeriesReviewPolicy,
      headers: { 'If-Match': input.etag, 'Idempotency-Key': input.idempotencyKey },
    });
  return snapshot(result, input.owner, 'Không thể lưu chính sách duyệt.');
}

type ApiResult = { data?: ReviewPolicyEnvelope | unknown; error?: unknown; response: Response };
function snapshot(result: ApiResult, owner: ReviewPolicyOwner, fallback: string): ReviewPolicySnapshot {
  if (result.error) throw apiError(result.error, result.response, fallback);
  if (!result.data || typeof result.data !== 'object' || !('data' in result.data)) {
    throw new ReviewPolicyApiError('Control Plane trả về chính sách duyệt không hợp lệ.');
  }
  const envelope = result.data as ReviewPolicyEnvelope;
  const etag = result.response.headers.get('ETag');
  const pattern = owner === 'channel' ? /^"[1-9]\d*"$/u : /^"[1-9]\d*:[1-9]\d*"$/u;
  if (!etag || !pattern.test(etag)) throw new ReviewPolicyApiError('Control Plane trả về Review Policy ETag không hợp lệ.');
  return { policy: envelope.data, etag };
}

function apiError(value: unknown, response: Response, fallback: string) {
  const problem = value as { code?: unknown; detail?: unknown };
  return new ReviewPolicyApiError(
    typeof problem.detail === 'string' ? problem.detail : fallback,
    typeof problem.code === 'string' ? problem.code : undefined,
    getSafeRequestId(value, response.headers.get('X-Request-Id')),
  );
}
