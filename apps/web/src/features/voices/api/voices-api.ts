import {
  activateVoiceProfile, archiveVoiceProfile, commitVoiceSampleUpload, createClient, createVoiceProfile,
  getVoiceProfile, listVoiceProfiles, previewVoiceSample, requestVoiceSampleUpload, restoreVoiceProfile,
  updateVoiceProfile, type CreateVoiceProfile, type UpdateVoiceProfile, type VoiceLicenseKind,
  type VoiceProfile, type VoiceProfileStatus,
} from '@reup-dubbing-studio/api-client';
import { z } from 'zod';
import { getSafeRequestId } from '@/shared/api/problem-details';
import { readRuntimeConfig } from '@/shared/config/runtime-config';

const uuid = z.string().uuid();
const status = z.enum(['DRAFT', 'READY', 'BLOCKED_LICENSE', 'ARCHIVED']);
const license = z.enum(['OWNED_RECORDING', 'AUTHORIZED_COMMERCIAL', 'CC_BY', 'CC_BY_NC', 'CUSTOM', 'UNKNOWN']);
const issue = z.enum(['VOICE_PRIMARY_SAMPLE_REQUIRED', 'VOICE_SAMPLE_TRANSCRIPT_REQUIRED', 'VOICE_SAMPLE_DURATION_INVALID', 'VOICE_LICENSE_REFERENCE_REQUIRED', 'VOICE_COMMERCIAL_USE_NOT_ALLOWED', 'VOICE_SAMPLE_NOT_AVAILABLE']);
const sample = z.object({ id: uuid, assetId: uuid, language: z.string(), transcript: z.string(), durationMs: z.number().int(), fileName: z.string(), contentType: z.string(), byteSize: z.string(), revision: z.number().int() });
const voice = z.object({
  id: uuid, name: z.string(), primaryLanguage: z.string(), description: z.string().nullable(), tags: z.array(z.string()),
  status, licenseKind: license, licenseReference: z.string().nullable(), sourceReference: z.string().nullable(), commercialUseAllowed: z.boolean(),
  samples: z.array(sample), readiness: z.enum(['READY', 'NEEDS_CONFIGURATION']), readinessIssues: z.array(issue),
  referencedBy: z.object({ channelProfiles: z.number().int(), seriesProfiles: z.number().int() }), version: z.number().int(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
const meta = z.object({ requestId: uuid });
const envelope = z.object({ data: voice, meta });
const listEnvelope = z.object({ data: z.object({ items: z.array(voice), nextCursor: z.string().nullable() }), meta });
const previewEnvelope = z.object({ data: z.object({ assetId: uuid, method: z.literal('GET'), url: z.string().url(), expiresAt: z.string().datetime(), fileName: z.string(), contentType: z.string(), byteSize: z.number() }), meta });
const uploadEnvelope = z.object({ data: z.object({ assetId: uuid, method: z.literal('PUT'), url: z.string().url(), headers: z.record(z.string(), z.string()), expiresAt: z.string().datetime(), maxByteSize: z.number() }), meta });

export type VoiceSnapshot = { profile: VoiceProfile; etag: string };
export type VoiceFilters = { query?: string; status?: VoiceProfileStatus; language?: string; tag?: string; commercialUseAllowed?: boolean; cursor?: string; limit?: number };
export class VoicesApiError extends Error { override readonly name = 'VoicesApiError'; constructor(message: string, readonly code?: string, readonly requestId?: string) { super(message); } }
function client() { return createClient({ baseUrl: readRuntimeConfig().controlPlaneUrl }); }

export async function fetchVoices(filters: VoiceFilters, signal?: AbortSignal) {
  const result = await listVoiceProfiles({ client: client(), query: filters, signal: requestSignal(signal) });
  return parse(result, listEnvelope, 'Không thể tải Thư viện giọng.').data;
}
export async function fetchVoice(id: string, signal?: AbortSignal) {
  return snapshot(await getVoiceProfile({ client: client(), path: { voiceProfileId: id }, signal: requestSignal(signal) }), 'Không thể tải Voice Profile.');
}
export async function addVoice(body: CreateVoiceProfile) {
  return snapshot(await createVoiceProfile({ client: client(), body, headers: { 'Idempotency-Key': crypto.randomUUID() } }), 'Không thể tạo Voice Profile.');
}
export async function saveVoice(id: string, etag: string, body: UpdateVoiceProfile) {
  return snapshot(await updateVoiceProfile({ client: client(), path: { voiceProfileId: id }, headers: { 'If-Match': etag }, body }), 'Không thể lưu Voice Profile.');
}
export async function activateVoice(id: string, etag: string) {
  return snapshot(await activateVoiceProfile({ client: client(), path: { voiceProfileId: id }, headers: { 'If-Match': etag } }), 'Voice chưa đủ điều kiện kích hoạt.');
}
export async function changeVoiceArchive(id: string, etag: string, action: 'archive' | 'restore') {
  const call = action === 'archive' ? archiveVoiceProfile : restoreVoiceProfile;
  return snapshot(await call({ client: client(), path: { voiceProfileId: id }, headers: { 'If-Match': etag } }), action === 'archive' ? 'Không thể lưu trữ Voice.' : 'Không thể khôi phục Voice.');
}
export async function uploadVoiceSample(input: { voiceId: string; etag: string; file: File; language: string; transcript: string; durationMs: number }) {
  const grantResult = await requestVoiceSampleUpload({ client: client(), path: { voiceProfileId: input.voiceId }, body: { language: input.language, transcript: input.transcript, durationMs: input.durationMs, fileName: input.file.name, contentType: input.file.type as 'audio/wav', byteSize: input.file.size } });
  const grant = parse(grantResult, uploadEnvelope, 'Không thể chuẩn bị upload sample.').data;
  const uploaded = await fetch(grant.url, { method: grant.method, headers: grant.headers, body: input.file });
  if (!uploaded.ok) throw new VoicesApiError('Không thể upload sample lên object storage.');
  const committed = await commitVoiceSampleUpload({ client: client(), path: { voiceProfileId: input.voiceId, assetId: grant.assetId }, headers: { 'If-Match': input.etag, 'Idempotency-Key': crypto.randomUUID() } });
  if (committed.error) throw apiError(committed.error, committed.response, 'Không thể xác nhận sample.');
}
export async function fetchSamplePreview(voiceId: string, sampleId: string) {
  return parse(await previewVoiceSample({ client: client(), path: { voiceProfileId: voiceId, sampleId } }), previewEnvelope, 'Không thể tải sample.').data;
}
function snapshot(result: ApiResult, fallback: string): VoiceSnapshot {
  const parsed = parse(result, envelope, fallback); const etag = result.response.headers.get('ETag');
  if (!etag || !/^"[1-9]\d*"$/u.test(etag)) throw new VoicesApiError('Control Plane trả về Voice ETag không hợp lệ.');
  return { profile: parsed.data, etag };
}
type ApiResult = { data?: unknown; error?: unknown; response: Response };
function parse<T>(result: ApiResult, schema: z.ZodType<T>, fallback: string): T { if (result.error) throw apiError(result.error, result.response, fallback); const parsed = schema.safeParse(result.data); if (!parsed.success) throw new VoicesApiError('Control Plane trả về dữ liệu Voice không hợp lệ.'); return parsed.data; }
function apiError(value: unknown, response: Response, fallback: string) { const problem = value as { code?: unknown; detail?: unknown }; return new VoicesApiError(typeof problem.detail === 'string' ? problem.detail : fallback, typeof problem.code === 'string' ? problem.code : undefined, getSafeRequestId(value, response.headers.get('X-Request-Id'))); }
function requestSignal(signal?: AbortSignal) { if (!signal) return null; try { new Request('about:blank', { signal }); return signal; } catch { return null; } }
export type { VoiceLicenseKind };
