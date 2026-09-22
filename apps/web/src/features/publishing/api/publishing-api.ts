import {
  approvePublicationContent,
  createClient,
  createPublicationProof,
  getPublicationTask,
  grantPublicationAssetDownload,
  listPublicationTasks,
  lockPublicationField,
  planPublicationTask,
  requestPublicationRevision,
  startManualPosting,
  updatePublicationChecklist,
  updatePublicationField,
  verifyPublicationProof,
  type CreatePublicationProof,
  type DownloadGrantEnvelope,
  type PlanPublicationTask,
  type PublicationChecklistStatus,
  type PublicationTask,
  type PublicationTaskListEnvelope,
  type PublicationTaskStatus,
  type PublishingPlatform,
} from '@reup-dubbing-studio/api-client';

import { getSafeRequestId } from '@/shared/api/problem-details';
import { readRuntimeConfig } from '@/shared/config/runtime-config';

export type PublicationTaskItem = PublicationTaskListEnvelope['data']['items'][number];
export type PublicationTaskFilters = {
  cursor?: string; limit?: number; status?: PublicationTaskStatus; platform?: PublishingPlatform;
  destinationId?: string; videoId?: string; scheduled?: boolean; overdue?: boolean;
};

export class PublishingApiError extends Error {
  override readonly name = 'PublishingApiError';
  constructor(message: string, readonly code?: string, readonly requestId?: string) { super(message); }
}

function client() { return createClient({ baseUrl: readRuntimeConfig().controlPlaneUrl }); }

export async function fetchPublicationTasks(filters: PublicationTaskFilters) {
  const result = await listPublicationTasks({ client: client(), query: filters });
  if (result.error) throw parseError(result.error, result.response);
  return requireEnvelope<PublicationTaskListEnvelope['data']>(result.data);
}

export async function fetchPublicationTask(id: string): Promise<PublicationTask> {
  const result = await getPublicationTask({ client: client(), path: { publicationTaskId: id } });
  if (result.error) throw parseError(result.error, result.response);
  return requireEnvelope<PublicationTask>(result.data);
}

export async function savePublicationField(task: PublicationTask, fieldKey: string, value: string) {
  const result = await updatePublicationField({ client: client(), path: { publicationTaskId: task.id, fieldKey }, headers: etag(task), body: { value } });
  return mutationResult(result);
}

export async function setPublicationFieldLock(task: PublicationTask, fieldKey: string, isLocked: boolean) {
  const result = await lockPublicationField({ client: client(), path: { publicationTaskId: task.id, fieldKey }, headers: etag(task), body: { isLocked } });
  return mutationResult(result);
}

export async function approvePublicationTask(task: PublicationTask, key: string) {
  const result = await approvePublicationContent({ client: client(), path: { publicationTaskId: task.id }, headers: { ...etag(task), 'Idempotency-Key': key } });
  return mutationResult(result);
}

export async function savePublicationPlan(task: PublicationTask, body: PlanPublicationTask) {
  const result = await planPublicationTask({ client: client(), path: { publicationTaskId: task.id }, headers: etag(task), body });
  return mutationResult(result);
}

export async function setPublicationChecklist(task: PublicationTask, itemKey: string, status: PublicationChecklistStatus) {
  const result = await updatePublicationChecklist({ client: client(), path: { publicationTaskId: task.id, itemKey }, headers: etag(task), body: { status } });
  return mutationResult(result);
}

export async function startPublicationPosting(task: PublicationTask, key: string) {
  const result = await startManualPosting({ client: client(), path: { publicationTaskId: task.id }, headers: { ...etag(task), 'Idempotency-Key': key } });
  return mutationResult(result);
}

export async function submitPublicationProof(task: PublicationTask, body: CreatePublicationProof, key: string) {
  const result = await createPublicationProof({ client: client(), path: { publicationTaskId: task.id }, headers: { ...etag(task), 'Idempotency-Key': key }, body });
  return mutationResult(result);
}

export async function verifyProof(task: PublicationTask, proofId: string, status: 'VERIFIED'|'FAILED', key: string) {
  const result = await verifyPublicationProof({ client: client(), path: { publicationTaskId: task.id, proofId }, headers: { ...etag(task), 'Idempotency-Key': key }, body: { status } });
  return mutationResult(result);
}

export async function reopenPublicationRevision(task: PublicationTask, key: string) {
  const result = await requestPublicationRevision({ client: client(), path: { publicationTaskId: task.id }, headers: { ...etag(task), 'Idempotency-Key': key } });
  return mutationResult(result);
}

export async function requestPublicationDownload(taskId: string, assetRole: 'VIDEO'|'SUBTITLE'|'THUMBNAIL') {
  const result = await grantPublicationAssetDownload({ client: client(), path: { publicationTaskId: taskId, assetRole } });
  if (result.error) throw parseError(result.error, result.response);
  return requireEnvelope<DownloadGrantEnvelope['data']>(result.data);
}

function etag(task: PublicationTask) { return { 'If-Match': `"${task.version}"` }; }
async function mutationResult(result: unknown): Promise<PublicationTask> {
  const response = result as { data?: unknown; error?: unknown; response: Response };
  if (response.error) throw parseError(response.error, response.response);
  return requireEnvelope<PublicationTask>(response.data);
}
function requireEnvelope<T>(value: unknown): T { if (!value || typeof value !== 'object' || !('data' in value)) throw new PublishingApiError('Control Plane không trả về dữ liệu Publishing.'); return (value as { data: T }).data; }
function parseError(value: unknown, response: Response) { const problem = value as { code?: unknown; detail?: unknown }; return new PublishingApiError(typeof problem.detail === 'string' ? problem.detail : 'Không thể hoàn tất thao tác đăng bài.', typeof problem.code === 'string' ? problem.code : undefined, getSafeRequestId(value, response.headers.get('X-Request-Id'))); }
