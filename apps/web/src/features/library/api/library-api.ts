import { createClient, deleteVideo, deleteVideos, getVideo, grantVideoOutput, listVideos, type VideoOutput } from '@reup-dubbing-studio/api-client';
import { z } from 'zod';
import { getSafeRequestId } from '@/shared/api/problem-details';
import { readRuntimeConfig } from '@/shared/config/runtime-config';
const uuid = z.string().uuid();
const outputPart = z.object({ assetId: uuid, status: z.string(), contentType: z.string().nullable(), fileName: z.string().nullable() }).nullable();
const output = z.object({ id: uuid, variant: z.string(), revision: z.number(), status: z.string(), video: outputPart, subtitle: outputPart, thumbnail: outputPart });
const grant = z.object({ method: z.literal('GET'), url: z.string().url(), expiresAt: z.string().datetime(), fileName: z.string(), contentType: z.string().nullable().optional() });
const video = z.object({ id: uuid, version: z.number(), displayTitle: z.string().nullable(), status: z.string(), sourceLanguage: z.string(), targetLanguage: z.string(), source: z.object({ platform: z.string(), externalId: z.string(), canonicalUrl: z.string().nullable(), durationMs: z.number().nullable(), creatorName: z.string().nullable() }), profile: z.object({ channelProfileId: uuid, channelProfileName: z.string(), seriesProfileId: uuid.nullable(), seriesProfileName: z.string().nullable() }), latestJob: z.object({ id: uuid, status: z.string() }).passthrough().nullable(), reviewStatus: z.string(), outputSummary: z.object({ readiness: z.enum(['NONE','PARTIAL','READY','CLEANED']), requiredVariants: z.array(z.string()), availableVariants: z.array(z.string()), warnings: z.array(z.string()) }), thumbnail: z.unknown().nullable(), outputs: z.array(output), assets: z.array(z.unknown()), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), ingestedAt: z.string().datetime().nullable(), archivedAt: z.string().datetime().nullable(), deletion: z.object({ requestedAt: z.string().datetime(), errorCode: z.string().nullable() }).nullable(), capabilities: z.object({ canOpenStudio: z.boolean(), canOpenPublishing: z.boolean(), canArchive: z.boolean(), canDelete: z.boolean(), deleteBlockedReason: z.enum(['PUBLICATION_HISTORY', 'DELETING']).nullable() }) });
const envelope = <T extends z.ZodTypeAny>(schema: T) => z.object({ data: schema });
export type LibraryFilters = { cursor?: string; limit?: number; status?: string; platform?: string; outputReadiness?: string; query?: string; includeArchived?: boolean };
export type LibraryVideo = z.infer<typeof video>;
export class LibraryApiError extends Error { override readonly name = 'LibraryApiError'; constructor(message: string, readonly code?: string, readonly requestId?: string) { super(message); } }
function client() { return createClient({ baseUrl: readRuntimeConfig().controlPlaneUrl }); }
export async function fetchVideos(filters: LibraryFilters, signal?: AbortSignal) { const result = await listVideos({ client: client(), query: filters as never, signal: requestSignal(signal) }); if (result.error) throw parseError(result.error, result.response); const parsed = envelope(z.object({ items: z.array(video), nextCursor: z.string().nullable() })).safeParse(result.data); if (!parsed.success) throw new LibraryApiError('Control Plane trả về dữ liệu Library không hợp lệ.'); return parsed.data.data; }
export async function fetchVideo(id: string, signal?: AbortSignal) { const result = await getVideo({ client: client(), path: { videoId: id }, signal: requestSignal(signal) }); if (result.error) throw parseError(result.error, result.response); const parsed = envelope(video).safeParse(result.data); if (!parsed.success) throw new LibraryApiError('Control Plane trả về chi tiết video không hợp lệ.'); return parsed.data.data; }
/** Some test/runtime environments hand back an AbortSignal from a different realm than the one `fetch`/undici expects; guard the same way queue-api.ts and discovery-api.ts do. */
function requestSignal(signal?: AbortSignal) { if (!signal) return null; try { new Request('about:blank', { signal }); return signal; } catch { return null; } }
export type OutputPart = 'video' | 'subtitle';
export type OutputFile = z.infer<typeof grant>;
/** Short-lived signed URL for one render output part; request it on each user action, never cache it. */
export async function requestOutputFile(videoId: string, outputId: string, part: OutputPart, purpose: 'preview' | 'download'): Promise<OutputFile> {
  const result = await grantVideoOutput({ client: client(), path: { videoId, renderOutputId: outputId, part }, body: { purpose } });
  if (result.error) throw parseError(result.error, result.response);
  const parsed = envelope(grant).safeParse(result.data);
  if (!parsed.success) throw new LibraryApiError('Control Plane trả về link tải không hợp lệ.');
  return parsed.data.data;
}
const deletionResult = z.object({ videoId: uuid, status: z.enum(['DELETING', 'DELETE_FAILED']), cancelledJobIds: z.array(uuid) });
const bulkResult = z.object({ items: z.array(z.object({ videoId: uuid, result: z.enum(['ACCEPTED', 'ALREADY_DELETING', 'HAS_PUBLICATION_HISTORY', 'VERSION_CONFLICT', 'NOT_FOUND']), cancelledJobIds: z.array(uuid) })) });
/** Asks the Control Plane to delete a video; objects are removed in the background. */
export async function deleteLibraryVideo(target: { id: string; version: number }, idempotencyKey: string) {
  const result = await deleteVideo({ client: client(), path: { videoId: target.id }, headers: { 'If-Match': `"${target.version}"`, 'Idempotency-Key': idempotencyKey } });
  if (result.error) throw parseError(result.error, result.response, 'Không thể xóa video.');
  const parsed = envelope(deletionResult).safeParse(result.data);
  if (!parsed.success) throw new LibraryApiError('Control Plane trả về kết quả xóa không hợp lệ.');
  return parsed.data.data;
}
export async function deleteLibraryVideos(items: Array<{ videoId: string; version: number }>, idempotencyKey: string) {
  const result = await deleteVideos({ client: client(), headers: { 'Idempotency-Key': idempotencyKey }, body: { items } });
  if (result.error) throw parseError(result.error, result.response, 'Không thể xóa các video đã chọn.');
  const parsed = envelope(bulkResult).safeParse(result.data);
  if (!parsed.success) throw new LibraryApiError('Control Plane trả về kết quả xóa không hợp lệ.');
  return parsed.data.data.items;
}
export type { VideoOutput };
function parseError(value: unknown, response: Response, fallback = 'Không thể tải thư viện video.') { const problem = value as { code?: unknown; detail?: unknown }; return new LibraryApiError(typeof problem.detail === 'string' ? problem.detail : fallback, typeof problem.code === 'string' ? problem.code : undefined, getSafeRequestId(value, response.headers.get('X-Request-Id'))); }
