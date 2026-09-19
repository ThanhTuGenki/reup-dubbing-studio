import {
  createClient,
  getSettings,
  testContentAgentConnection,
  testStorageConnection,
  updateSettings,
  type ContentAgentTestRequest,
  type Settings,
  type SettingsPatch,
  type StorageTestRequest,
} from '@reup-dubbing-studio/api-client';
import { z } from 'zod';

import { getSafeRequestId } from '../../../shared/api/problem-details';
import { readRuntimeConfig } from '../../../shared/config/runtime-config';

const credentialState = z.object({
  configured: z.boolean(), hint: z.string().nullable(), rotatedAt: z.string().datetime().nullable(),
});
const settingsEnvelope = z.object({
  data: z.object({
    version: z.number().int().positive(),
    contentAgent: z.object({ provider: z.enum(['ANTHROPIC', 'OPENAI']), model: z.string(), credential: credentialState }),
    storage: z.object({ backend: z.literal('R2'), accountId: z.string(), bucket: z.string(), credential: credentialState }),
    retention: z.object({
      rawVideoDays: z.number().int(), intermediateDays: z.number().int(),
      taskLogDays: z.number().int(), finalOutputDays: z.number().int(),
    }),
  }),
  meta: z.object({ requestId: z.string().uuid() }),
});
const connectionEnvelope = z.object({
  data: z.object({ status: z.literal('CONNECTED'), latencyMs: z.number().int().nonnegative(), checkedAt: z.string().datetime(), message: z.string() }),
  meta: z.object({ requestId: z.string().uuid() }),
});

export type SettingsSnapshot = { settings: Settings; etag: string; requestId: string };

export class SettingsApiError extends Error {
  override readonly name = 'SettingsApiError';
  constructor(
    message: string,
    readonly code?: string,
    readonly requestId?: string,
  ) { super(message); }
}

function client() {
  return createClient({ baseUrl: readRuntimeConfig().controlPlaneUrl });
}

export async function fetchSettings(signal?: AbortSignal): Promise<SettingsSnapshot> {
  const compatibleSignal = requestSignal(signal);
  const result = await getSettings({ client: client(), ...(compatibleSignal ? { signal: compatibleSignal } : {}) });
  if (result.error) throw apiError(result.error, result.response, 'Không thể tải cài đặt hệ thống.');
  const parsed = settingsEnvelope.safeParse(result.data);
  const etag = result.response.headers.get('ETag');
  if (!parsed.success || !etag || !/^"[1-9]\d*"$/u.test(etag)) {
    throw new SettingsApiError('Control Plane trả về cài đặt không hợp lệ.');
  }
  return { settings: parsed.data.data, etag, requestId: parsed.data.meta.requestId };
}

function requestSignal(signal: AbortSignal | undefined): AbortSignal | undefined {
  if (!signal) return undefined;
  try { new Request('about:blank', { signal }); return signal; } catch { return undefined; }
}

export async function saveSettings(input: {
  etag: string;
  idempotencyKey: string;
  patch: SettingsPatch;
}): Promise<SettingsSnapshot> {
  const result = await updateSettings({
    client: client(), body: input.patch,
    headers: { 'If-Match': input.etag, 'Idempotency-Key': input.idempotencyKey },
  });
  if (result.error) throw apiError(result.error, result.response, 'Không thể lưu cài đặt.');
  const parsed = settingsEnvelope.safeParse(result.data);
  const etag = result.response.headers.get('ETag');
  if (!parsed.success || !etag) throw new SettingsApiError('Control Plane trả về cài đặt không hợp lệ.');
  return { settings: parsed.data.data, etag, requestId: parsed.data.meta.requestId };
}

export async function testContentAgent(input: ContentAgentTestRequest) {
  const result = await testContentAgentConnection({ client: client(), body: input });
  if (result.error) throw apiError(result.error, result.response, 'Không thể kết nối Content Agent.');
  const parsed = connectionEnvelope.safeParse(result.data);
  if (!parsed.success) throw new SettingsApiError('Control Plane trả về kết quả kiểm tra không hợp lệ.');
  return parsed.data.data;
}

export async function testStorage(input: StorageTestRequest) {
  const result = await testStorageConnection({ client: client(), body: input });
  if (result.error) throw apiError(result.error, result.response, 'Không thể kết nối Cloudflare R2.');
  const parsed = connectionEnvelope.safeParse(result.data);
  if (!parsed.success) throw new SettingsApiError('Control Plane trả về kết quả kiểm tra không hợp lệ.');
  return parsed.data.data;
}

function apiError(value: unknown, response: Response, fallback: string): SettingsApiError {
  const problem = value as { code?: unknown; detail?: unknown };
  return new SettingsApiError(
    typeof problem.detail === 'string' ? problem.detail : fallback,
    typeof problem.code === 'string' ? problem.code : undefined,
    getSafeRequestId(value, response.headers.get('X-Request-Id')),
  );
}
