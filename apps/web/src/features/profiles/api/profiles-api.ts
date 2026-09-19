import {
  archiveChannelProfile,
  archiveSeriesProfile,
  commitSeriesProfileAssetUpload,
  createChannelProfile,
  createClient,
  createSeriesProfile,
  getChannelProfile,
  getSeriesProfile,
  listChannelProfiles,
  listSeriesProfiles,
  previewSeriesProfileAsset,
  requestSeriesProfileAssetUpload,
  restoreChannelProfile,
  restoreSeriesProfile,
  updateChannelProfile,
  updateSeriesProfile,
  type ChannelProfile,
  type CreateChannelProfile,
  type CreateSeriesProfile,
  type ProfileStatus,
  type SeriesProfile,
  type UpdateChannelProfile,
  type UpdateSeriesProfile,
} from '@reup-dubbing-studio/api-client';
import { z } from 'zod';

import { getSafeRequestId } from '../../../shared/api/problem-details';
import { readRuntimeConfig } from '../../../shared/config/runtime-config';

const uuid = z.string().uuid();
const status = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);
const readiness = z.enum(['READY', 'NEEDS_CONFIGURATION']);
const readinessIssue = z.enum([
  'DEFAULT_VOICE_REQUIRED', 'DEFAULT_VOICE_NOT_READY', 'OUTPUT_REQUIRED', 'MASK_REQUIRED',
  'MASK_REFERENCE_ASSET_REQUIRED', 'CAST_REQUIRED', 'CAST_VOICE_NOT_READY', 'PARENT_CHANNEL_NOT_ACTIVE',
]);
const pipeline = z.object({
  targetLanguage: z.string(), defaultVoiceProfileId: uuid.nullable(),
  voiceMode: z.enum(['SINGLE', 'DUAL', 'MULTI_AUTO']), subtitleLanguage: z.string(),
  subtitleFilenameRule: z.string(), subtitleMaxLineLength: z.number().int().nullable(),
  ttsSpeed: z.number(), timingPolicy: z.enum(['PRESERVE_SEGMENT', 'FIT_SEGMENT', 'ALLOW_DRIFT']),
  output16x9Enabled: z.boolean(), output9x16Enabled: z.boolean(),
});
const asset = z.object({
  linkId: uuid, assetId: uuid, role: z.enum(['INTRO', 'OUTRO', 'LOGO', 'WATERMARK', 'MASK_REFERENCE_FRAME']),
  fileName: z.string(), contentType: z.string().nullable(), byteSize: z.string().nullable(),
  width: z.number().int().nullable(), height: z.number().int().nullable(), revision: z.number().int(),
});
const channel = z.object({
  id: uuid, name: z.string(), status, pipeline,
  content: z.object({
    voiceRules: z.record(z.string(), z.unknown()), ctaTemplate: z.string().nullable(),
    metadataTemplate: z.record(z.string(), z.unknown()), baseKeywords: z.array(z.string()),
  }),
  destinations: z.array(z.object({
    id: uuid, platform: z.enum(['YOUTUBE', 'FACEBOOK']), externalId: z.string().nullable(),
    displayName: z.string(), isRequired: z.boolean(), isActive: z.boolean(),
    platformConfig: z.record(z.string(), z.unknown()), version: z.number().int(),
  })),
  assets: z.array(asset), readiness, readinessIssues: z.array(readinessIssue),
  version: z.number().int(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
const overrides = z.object({
  targetLanguage: z.string().nullable(), defaultVoiceProfileId: uuid.nullable(),
  voiceMode: z.enum(['SINGLE', 'DUAL', 'MULTI_AUTO']).nullable(), subtitleLanguage: z.string().nullable(),
  subtitleFilenameRule: z.string().nullable(), subtitleMaxLineLength: z.number().int().nullable(),
  ttsSpeed: z.number().nullable(), timingPolicy: z.enum(['PRESERVE_SEGMENT', 'FIT_SEGMENT', 'ALLOW_DRIFT']).nullable(),
  output16x9Enabled: z.boolean().nullable(), output9x16Enabled: z.boolean().nullable(),
});
const series = z.object({
  id: uuid, channelProfileId: uuid, name: z.string(), status, overrides,
  effectiveConfig: pipeline,
  inheritance: z.object({
    targetLanguage: z.enum(['CHANNEL', 'SERIES']), defaultVoiceProfileId: z.enum(['CHANNEL', 'SERIES']),
    voiceMode: z.enum(['CHANNEL', 'SERIES']), subtitleLanguage: z.enum(['CHANNEL', 'SERIES']),
    subtitleFilenameRule: z.enum(['CHANNEL', 'SERIES']), subtitleMaxLineLength: z.enum(['CHANNEL', 'SERIES']),
    ttsSpeed: z.enum(['CHANNEL', 'SERIES']), timingPolicy: z.enum(['CHANNEL', 'SERIES']),
    output16x9Enabled: z.enum(['CHANNEL', 'SERIES']), output9x16Enabled: z.enum(['CHANNEL', 'SERIES']),
  }),
  mask: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable(),
  assets: z.array(asset), readiness, readinessIssues: z.array(readinessIssue),
  version: z.number().int(), parentVersion: z.number().int(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
const meta = z.object({ requestId: uuid });
const channelEnvelope = z.object({ data: channel, meta });
const seriesEnvelope = z.object({ data: series, meta });
const channelListEnvelope = z.object({ data: z.object({ items: z.array(channel), nextCursor: z.string().nullable() }), meta });
const seriesListEnvelope = z.object({ data: z.object({ items: z.array(series), nextCursor: z.string().nullable() }), meta });
const previewEnvelope = z.object({ data: z.object({
  assetId: uuid, method: z.literal('GET'), url: z.string().url(), expiresAt: z.string().datetime(),
  fileName: z.string(), contentType: z.string(), byteSize: z.number(),
}), meta });
const uploadEnvelope = z.object({ data: z.object({
  assetId: uuid, method: z.literal('PUT'), url: z.string().url(),
  headers: z.record(z.string(), z.string()), expiresAt: z.string().datetime(), maxByteSize: z.number(),
}), meta });

export type ChannelSnapshot = { profile: ChannelProfile; etag: string };
export type SeriesSnapshot = { profile: SeriesProfile; etag: string };
export type ProfileListFilters = { query?: string; status?: ProfileStatus; cursor?: string; limit?: number; channelProfileId?: string };

export class ProfilesApiError extends Error {
  override readonly name = 'ProfilesApiError';
  constructor(message: string, readonly code?: string, readonly requestId?: string) { super(message); }
}

function client() { return createClient({ baseUrl: readRuntimeConfig().controlPlaneUrl }); }

export async function fetchChannelProfiles(filters: ProfileListFilters, signal?: AbortSignal) {
  const result = await listChannelProfiles({ client: client(), query: filters, signal: requestSignal(signal) });
  return parseResult(result, channelListEnvelope, 'Không thể tải Channel Profile.').data;
}

export async function fetchSeriesProfiles(filters: ProfileListFilters, signal?: AbortSignal) {
  const result = await listSeriesProfiles({ client: client(), query: filters, signal: requestSignal(signal) });
  return parseResult(result, seriesListEnvelope, 'Không thể tải Series Profile.').data;
}

export async function fetchChannelProfile(id: string, signal?: AbortSignal): Promise<ChannelSnapshot> {
  const result = await getChannelProfile({ client: client(), path: { channelProfileId: id }, signal: requestSignal(signal) });
  return snapshot(result, channelEnvelope, /^"[1-9]\d*"$/u, 'Không thể tải Channel Profile.');
}

export async function fetchSeriesProfile(id: string, signal?: AbortSignal): Promise<SeriesSnapshot> {
  const result = await getSeriesProfile({ client: client(), path: { seriesProfileId: id }, signal: requestSignal(signal) });
  return snapshot(result, seriesEnvelope, /^"[1-9]\d*:[1-9]\d*"$/u, 'Không thể tải Series Profile.');
}

export async function addChannelProfile(body: CreateChannelProfile): Promise<ChannelSnapshot> {
  const result = await createChannelProfile({ client: client(), body, headers: { 'Idempotency-Key': crypto.randomUUID() } });
  return snapshot(result, channelEnvelope, /^"[1-9]\d*"$/u, 'Không thể tạo Channel Profile.');
}

export async function saveChannelProfile(id: string, etag: string, body: UpdateChannelProfile): Promise<ChannelSnapshot> {
  const result = await updateChannelProfile({ client: client(), path: { channelProfileId: id }, headers: { 'If-Match': etag }, body });
  return snapshot(result, channelEnvelope, /^"[1-9]\d*"$/u, 'Không thể lưu Channel Profile.');
}

export async function changeChannelArchive(id: string, etag: string, action: 'archive' | 'restore') {
  const call = action === 'archive' ? archiveChannelProfile : restoreChannelProfile;
  const result = await call({ client: client(), path: { channelProfileId: id }, headers: { 'If-Match': etag } });
  return snapshot(result, channelEnvelope, /^"[1-9]\d*"$/u, `Không thể ${action === 'archive' ? 'archive' : 'khôi phục'} Channel Profile.`);
}

export async function addSeriesProfile(body: CreateSeriesProfile): Promise<SeriesSnapshot> {
  const result = await createSeriesProfile({ client: client(), body, headers: { 'Idempotency-Key': crypto.randomUUID() } });
  return snapshot(result, seriesEnvelope, /^"[1-9]\d*:[1-9]\d*"$/u, 'Không thể tạo Series Profile.');
}

export async function saveSeriesProfile(id: string, etag: string, body: UpdateSeriesProfile): Promise<SeriesSnapshot> {
  const result = await updateSeriesProfile({ client: client(), path: { seriesProfileId: id }, headers: { 'If-Match': etag }, body });
  return snapshot(result, seriesEnvelope, /^"[1-9]\d*:[1-9]\d*"$/u, 'Không thể lưu Series Profile.');
}

export async function changeSeriesArchive(id: string, etag: string, action: 'archive' | 'restore') {
  const call = action === 'archive' ? archiveSeriesProfile : restoreSeriesProfile;
  const result = await call({ client: client(), path: { seriesProfileId: id }, headers: { 'If-Match': etag } });
  return snapshot(result, seriesEnvelope, /^"[1-9]\d*:[1-9]\d*"$/u, `Không thể ${action === 'archive' ? 'archive' : 'khôi phục'} Series Profile.`);
}

export async function uploadMaskReference(input: { profileId: string; etag: string; file: File; width: number; height: number }) {
  const grantResult = await requestSeriesProfileAssetUpload({
    client: client(), path: { seriesProfileId: input.profileId },
    body: { role: 'MASK_REFERENCE_FRAME', fileName: input.file.name, contentType: input.file.type, byteSize: input.file.size, width: input.width, height: input.height },
  });
  const grant = parseResult(grantResult, uploadEnvelope, 'Không thể chuẩn bị upload reference frame.').data;
  const uploaded = await fetch(grant.url, { method: grant.method, headers: grant.headers, body: input.file });
  if (!uploaded.ok) throw new ProfilesApiError('Không thể upload reference frame lên object storage.');
  const committed = await commitSeriesProfileAssetUpload({
    client: client(), path: { seriesProfileId: input.profileId, assetId: grant.assetId },
    headers: { 'If-Match': input.etag, 'Idempotency-Key': crypto.randomUUID() },
  });
  if (committed.error) throw apiError(committed.error, committed.response, 'Không thể xác nhận reference frame.');
  const etag = committed.response.headers.get('ETag');
  if (!etag) throw new ProfilesApiError('Control Plane không trả về version mới của Series Profile.');
  return etag;
}

export async function fetchMaskPreview(profileId: string, linkId: string) {
  const result = await previewSeriesProfileAsset({ client: client(), path: { seriesProfileId: profileId, linkId } });
  return parseResult(result, previewEnvelope, 'Không thể tải preview reference frame.').data;
}

function snapshot<T extends ChannelProfile | SeriesProfile>(
  result: ApiResult, schema: z.ZodType<{ data: T }>, pattern: RegExp, fallback: string,
): { profile: T; etag: string } {
  const parsed = parseResult(result, schema, fallback);
  const etag = result.response.headers.get('ETag');
  if (!etag || !pattern.test(etag)) throw new ProfilesApiError('Control Plane trả về Profile ETag không hợp lệ.');
  return { profile: parsed.data, etag };
}

type ApiResult = { data?: unknown; error?: unknown; response: Response };
function parseResult<T>(result: ApiResult, schema: z.ZodType<T>, fallback: string): T {
  if (result.error) throw apiError(result.error, result.response, fallback);
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) throw new ProfilesApiError('Control Plane trả về dữ liệu Profile không hợp lệ.');
  return parsed.data;
}
function apiError(value: unknown, response: Response, fallback: string) {
  const problem = value as { code?: unknown; detail?: unknown };
  return new ProfilesApiError(
    typeof problem.detail === 'string' ? problem.detail : fallback,
    typeof problem.code === 'string' ? problem.code : undefined,
    getSafeRequestId(value, response.headers.get('X-Request-Id')),
  );
}
function requestSignal(signal: AbortSignal | undefined): AbortSignal | null {
  if (!signal) return null;
  try { new Request('about:blank', { signal }); return signal; } catch { return null; }
}
