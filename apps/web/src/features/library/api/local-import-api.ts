import {
  commitLocalVideoImport,
  createClient,
  requestLocalVideoUpload,
  type LocalVideoImportResult,
} from '@reup-dubbing-studio/api-client';
import { z } from 'zod';

import { getSafeRequestId } from '@/shared/api/problem-details';
import { readRuntimeConfig } from '@/shared/config/runtime-config';

const uuid = z.string().uuid();
const grantEnvelope = z.object({ data: z.object({
  assetId: uuid, method: z.literal('PUT'), url: z.string().url(),
  headers: z.record(z.string(), z.string()), expiresAt: z.string().datetime(), maxByteSize: z.number(),
}) });
const resultEnvelope = z.object({ data: z.object({
  videoId: uuid, jobId: uuid, rawAssetId: uuid, status: z.literal('WAITING_FOR_GPU'),
}) });

export type LocalVideoMetadata = { durationMs: number; width: number; height: number };
export type LocalImportProgress = { phase: 'HASHING' | 'UPLOADING' | 'COMMITTING'; percent: number };

export class LocalImportApiError extends Error {
  override readonly name = 'LocalImportApiError';
  constructor(message: string, readonly code?: string, readonly requestId?: string) { super(message); }
}

function client() { return createClient({ baseUrl: readRuntimeConfig().controlPlaneUrl }); }

export async function importLocalVideo(input: {
  file: File; title: string; sourceLanguage: string; channelProfileId: string; seriesProfileId?: string;
  metadata: LocalVideoMetadata; onProgress: (progress: LocalImportProgress) => void;
}): Promise<LocalVideoImportResult> {
  input.onProgress({ phase: 'HASHING', percent: 0 });
  const checksumSha256 = await sha256(input.file);
  input.onProgress({ phase: 'HASHING', percent: 100 });
  const requested = await requestLocalVideoUpload({
    client: client(), headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: {
      channelProfileId: input.channelProfileId,
      ...(input.seriesProfileId ? { seriesProfileId: input.seriesProfileId } : {}),
      title: input.title.trim(), sourceLanguage: input.sourceLanguage.trim(),
      fileName: input.file.name, contentType: 'video/mp4', byteSize: input.file.size,
      checksumSha256, ...input.metadata,
    },
  });
  const grant = parse(requested, grantEnvelope, 'Không thể chuẩn bị upload video.').data;
  await upload(grant.url, grant.headers, input.file, (percent) => input.onProgress({ phase: 'UPLOADING', percent }));
  input.onProgress({ phase: 'COMMITTING', percent: 0 });
  const committed = await commitLocalVideoImport({
    client: client(), path: { assetId: grant.assetId }, headers: { 'Idempotency-Key': crypto.randomUUID() },
  });
  const result = parse(committed, resultEnvelope, 'Không thể xác nhận video đã upload.').data;
  input.onProgress({ phase: 'COMMITTING', percent: 100 });
  return result;
}

export function readVideoMetadata(file: File): Promise<LocalVideoMetadata> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const video = document.createElement('video');
    const done = () => { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); };
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const value = { durationMs: Math.round(video.duration * 1_000), width: video.videoWidth, height: video.videoHeight };
      done();
      if (!Number.isSafeInteger(value.durationMs) || value.durationMs < 1 || value.width < 1 || value.height < 1) reject(new LocalImportApiError('Không đọc được metadata video.'));
      else resolve(value);
    };
    video.onerror = () => { done(); reject(new LocalImportApiError('File MP4 không đọc được hoặc đã hỏng.')); };
    video.src = url;
  });
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function upload(url: string, headers: Record<string, string>, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest(); request.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    request.onerror = () => reject(new LocalImportApiError('Mất kết nối khi upload video lên R2.'));
    request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new LocalImportApiError(`R2 từ chối upload (HTTP ${request.status}).`));
    request.send(file);
  });
}

type ApiResult = { data?: unknown; error?: unknown; response: Response };
function parse<T>(result: ApiResult, schema: z.ZodType<T>, fallback: string): T {
  if (result.error) {
    const problem = result.error as { code?: unknown; detail?: unknown };
    throw new LocalImportApiError(typeof problem.detail === 'string' ? problem.detail : fallback, typeof problem.code === 'string' ? problem.code : undefined, getSafeRequestId(result.error, result.response.headers.get('X-Request-Id')));
  }
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) throw new LocalImportApiError('Control Plane trả về dữ liệu import không hợp lệ.');
  return parsed.data;
}
