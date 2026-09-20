import {
  confirmWorkerTermination,
  createClient,
  createWorker,
  drainWorker,
  getWorker,
  listWorkerImages,
  listWorkers,
  type CreateWorker,
  type Worker,
  type WorkerImage,
} from '@reup-dubbing-studio/api-client';
import { z } from 'zod';
import { getSafeRequestId } from '@/shared/api/problem-details';
import { readRuntimeConfig } from '@/shared/config/runtime-config';

const uuid = z.string().uuid();
const image = z.object({ id: uuid, role: z.enum(['BATCH_MEDIA', 'INTERACTIVE_TTS']), semanticVersion: z.string(), imageDigest: z.string(), registryRef: z.string(), contractVersion: z.number().int(), status: z.enum(['ACTIVE', 'REVOKED']), approvedAt: z.string().datetime(), revokedAt: z.string().datetime().nullable(), version: z.number().int() });
const session = z.object({ id: uuid, sessionNonce: uuid, imageDigest: z.string(), agentVersion: z.string(), contractVersion: z.number().int(), capacity: z.record(z.string(), z.unknown()), currentTaskCount: z.number().int(), lastHeartbeatSequence: z.string(), startedAt: z.string().datetime(), lastHeartbeatAt: z.string().datetime() }).passthrough();
const worker = z.object({ id: uuid, displayName: z.string(), role: z.enum(['BATCH_MEDIA', 'INTERACTIVE_TTS']), provider: z.string(), mode: z.enum(['MANUAL_REGISTERED', 'API_PROVISIONED']), desiredStatus: z.enum(['ACTIVE', 'DRAINING', 'REVOKED']), observedStatus: z.enum(['PENDING', 'READY', 'BUSY', 'DRAINING', 'SAFE_TO_TERMINATE', 'OFFLINE', 'TERMINATED', 'ERROR']), approvedImage: image, currentSession: session.nullable(), activeLeaseCount: z.number().int().min(0), safeToTerminate: z.boolean(), billing: z.record(z.string(), z.unknown()).nullable(), lastError: z.record(z.string(), z.unknown()).nullable(), version: z.number().int(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() }).passthrough();
const meta = z.object({ requestId: uuid });
const workerEnvelope = z.object({ data: worker, meta });
const workerListEnvelope = z.object({ data: z.object({ items: z.array(worker), nextCursor: z.string().nullable() }), meta });
const imageListEnvelope = z.object({ data: z.object({ items: z.array(image), nextCursor: z.string().nullable() }), meta });
const createEnvelope = z.object({ data: z.object({ worker, enrollment: z.object({ secretAvailable: z.boolean(), token: z.string().nullable(), expiresAt: z.string().datetime().nullable() }) }), meta });

export type CreateWorkerResult = z.infer<typeof createEnvelope>['data'];
export class WorkersApiError extends Error { override readonly name = 'WorkersApiError'; constructor(message: string, readonly code?: string, readonly requestId?: string) { super(message); } }
function apiClient() { return createClient({ baseUrl: readRuntimeConfig().controlPlaneUrl }); }
export function workerEventsUrl() { return `${readRuntimeConfig().controlPlaneUrl}/worker-events`; }
export async function fetchWorkers(signal?: AbortSignal) { return parse(await listWorkers({ client: apiClient(), query: { limit: 100 }, signal: requestSignal(signal) }), workerListEnvelope, 'Không thể tải danh sách worker.').data as { items: Worker[]; nextCursor: string | null }; }
export async function fetchWorkerImages(signal?: AbortSignal) { return parse(await listWorkerImages({ client: apiClient(), signal: requestSignal(signal) }), imageListEnvelope, 'Không thể tải danh sách image đã duyệt.').data.items as WorkerImage[]; }
export async function fetchWorker(id: string, signal?: AbortSignal) { return parse(await getWorker({ client: apiClient(), path: { workerId: id }, signal: requestSignal(signal) }), workerEnvelope, 'Không thể tải chi tiết worker.').data as Worker; }
export async function addWorker(input: CreateWorker, idempotencyKey: string) { return parse(await createWorker({ client: apiClient(), headers: { 'Idempotency-Key': idempotencyKey }, body: input }), createEnvelope, 'Không thể thêm worker.').data as CreateWorkerResult; }
export async function requestDrain(value: Worker, idempotencyKey: string) { return mutate(value, idempotencyKey, drainWorker, 'Không thể drain worker.'); }
export async function confirmTermination(value: Worker, idempotencyKey: string) { return mutate(value, idempotencyKey, confirmWorkerTermination, 'Không thể xác nhận rental đã xóa.'); }

type ApiResult = { data?: unknown; error?: unknown; response: Response };
async function mutate(value: Worker, idempotencyKey: string, operation: typeof drainWorker, fallback: string) { return parse(await operation({ client: apiClient(), path: { workerId: value.id }, headers: { 'If-Match': `"${value.version}"`, 'Idempotency-Key': idempotencyKey } }), workerEnvelope, fallback).data as Worker; }
function parse<T>(result: ApiResult, schema: z.ZodType<T>, fallback: string): T { if (result.error) throw apiError(result.error, result.response, fallback); const parsed = schema.safeParse(result.data); if (!parsed.success) throw new WorkersApiError('Control Plane trả về dữ liệu GPU Worker không hợp lệ.'); return parsed.data; }
function apiError(value: unknown, response: Response, fallback: string) { const problem = value as { code?: unknown; detail?: unknown }; return new WorkersApiError(typeof problem.detail === 'string' ? problem.detail : fallback, typeof problem.code === 'string' ? problem.code : undefined, getSafeRequestId(value, response.headers.get('X-Request-Id'))); }
function requestSignal(signal?: AbortSignal) { if (!signal) return null; try { new Request('about:blank', { signal }); return signal; } catch { return null; } }
