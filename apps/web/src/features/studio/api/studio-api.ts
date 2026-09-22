import {
  createClient,
  createStudioReviewDecision,
  getStudio,
  previewStudioSegment,
  regenerateStudioSegment,
  requestStudioRender,
  updateStudioSegment,
  type StudioEnvelope,
  type StudioAssetEnvelope,
  type StudioMutationEnvelope,
  type StudioReviewRequest,
  type StudioSegment,
  type StudioSegmentPatch,
} from '@reup-dubbing-studio/api-client';

import { getSafeRequestId } from '@/shared/api/problem-details';
import { readRuntimeConfig } from '@/shared/config/runtime-config';

export type Studio = StudioEnvelope['data'];
export type { StudioSegment };
export type StudioSegmentDraft = StudioSegmentPatch;

export class StudioApiError extends Error {
  override readonly name = 'StudioApiError';
  constructor(message: string, readonly code?: string, readonly requestId?: string) { super(message); }
}

function client() { return createClient({ baseUrl: readRuntimeConfig().controlPlaneUrl }); }
export function studioWorkflowEventsUrl() { return `${readRuntimeConfig().controlPlaneUrl}/queue/events`; }

export async function fetchStudio(videoId: string): Promise<Studio> {
  const result = await getStudio({ client: client(), path: { videoId } });
  if (result.error) throw parseError(result.error, result.response);
  return requireData<Studio>(result.data);
}

export async function saveStudioSegment(videoId: string, segmentId: string, version: number, body: StudioSegmentDraft) {
  const result = await updateStudioSegment({ client: client(), path: { videoId, segmentId }, headers: { 'If-Match': `"${version}"` }, body });
  if (result.error) throw parseError(result.error, result.response);
  return requireData<StudioMutationEnvelope['data']>(result.data);
}

export async function requestSegmentPreview(videoId: string, segmentId: string) {
  const result = await previewStudioSegment({ client: client(), path: { videoId, segmentId } });
  if (result.error) throw parseError(result.error, result.response);
  return requireData<StudioAssetEnvelope['data']>(result.data);
}

export async function regenerateSegment(videoId: string, segmentId: string, version: number, idempotencyKey: string) {
  const result = await regenerateStudioSegment({ client: client(), path: { videoId, segmentId }, headers: { 'If-Match': `"${version}"`, 'Idempotency-Key': idempotencyKey } });
  if (result.error) throw parseError(result.error, result.response);
  return requireData<StudioMutationEnvelope['data']>(result.data);
}

export async function reviewStudio(videoId: string, version: number, body: StudioReviewRequest) {
  const result = await createStudioReviewDecision({ client: client(), path: { videoId }, headers: { 'If-Match': `"${version}"` }, body });
  if (result.error) throw parseError(result.error, result.response);
  return requireData<StudioMutationEnvelope['data']>(result.data);
}

export async function renderStudio(videoId: string, version: number, idempotencyKey: string) {
  const result = await requestStudioRender({ client: client(), path: { videoId }, headers: { 'If-Match': `"${version}"`, 'Idempotency-Key': idempotencyKey } });
  if (result.error) throw parseError(result.error, result.response);
  return requireData<StudioMutationEnvelope['data']>(result.data);
}

function requireData<T>(value: unknown): T {
  if (!value || typeof value !== 'object' || !('data' in value)) throw new StudioApiError('Control Plane không trả về dữ liệu Studio.');
  return (value as { data: T }).data;
}

function parseError(value: unknown, response: Response) {
  const problem = value as { code?: unknown; detail?: unknown };
  return new StudioApiError(typeof problem.detail === 'string' ? problem.detail : 'Không thể hoàn tất thao tác Studio.', typeof problem.code === 'string' ? problem.code : undefined, getSafeRequestId(value, response.headers.get('X-Request-Id')));
}
