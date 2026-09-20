import {
  createClient,
  createIngestJobs,
  preflightIngestJobs,
  type IngestCreateResult,
  type IngestPreflight,
  type IngestSelection,
} from '@reup-dubbing-studio/api-client';
import { z } from 'zod';
import { getSafeRequestId } from '@/shared/api/problem-details';
import { readRuntimeConfig } from '@/shared/config/runtime-config';

const uuid = z.string().uuid();
const meta = z.object({ requestId: uuid });
const disposition = z.enum([
  'READY', 'READY_RETRY', 'ALREADY_QUEUED', 'ALREADY_INGESTED', 'SOURCE_NOT_FOUND',
  'SOURCE_UNAVAILABLE', 'SOURCE_NOT_INGEST_ELIGIBLE', 'SOURCE_ACCOUNT_UNAVAILABLE',
  'SOURCE_CREDENTIAL_REQUIRED', 'PROFILE_NOT_READY', 'SERIES_NOT_READY',
  'SERIES_CHANNEL_MISMATCH', 'VIDEO_PROFILE_CONFLICT',
]);
const preflightItem = z.object({
  sourceContentId: uuid, disposition, existingVideoId: uuid.nullable(),
  existingJobId: uuid.nullable(), issues: z.array(z.string()),
});
const preflight = z.object({
  summary: z.object({ total: z.number().int(), ready: z.number().int(), blocked: z.number().int() }),
  items: z.array(preflightItem),
});
const createItem = z.object({
  sourceContentId: uuid,
  result: z.enum(['CREATED', 'ALREADY_QUEUED', 'ALREADY_INGESTED', 'SKIPPED_INVALID']),
  videoId: uuid.nullable(), jobId: uuid.nullable(), taskId: uuid.nullable(),
  jobStatus: z.literal('QUEUED').nullable(), videoStatus: z.string().nullable(), issues: z.array(z.string()),
});
const createResult = z.object({
  summary: z.object({ total: z.number().int(), created: z.number().int(), reused: z.number().int(), skipped: z.number().int() }),
  items: z.array(createItem),
});
const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ data, meta });

export class IngestApiError extends Error {
  override readonly name = 'IngestApiError';
  constructor(message: string, readonly code?: string, readonly requestId?: string) { super(message); }
}

function client() { return createClient({ baseUrl: readRuntimeConfig().controlPlaneUrl }); }

export async function preflightSelection(body: IngestSelection): Promise<IngestPreflight> {
  const result = await preflightIngestJobs({ client: client(), body });
  return parse(result, envelope(preflight), 'Không thể kiểm tra video đã chọn.').data as IngestPreflight;
}

export async function submitIngestJobs(body: IngestSelection, idempotencyKey: string): Promise<IngestCreateResult> {
  const result = await createIngestJobs({ client: client(), headers: { 'Idempotency-Key': idempotencyKey }, body });
  return parse(result, envelope(createResult), 'Không thể tạo job ingest.').data as IngestCreateResult;
}

type ApiResult = { data?: unknown; error?: unknown; response: Response };
function parse<T>(result: ApiResult, schema: z.ZodType<T>, fallback: string): T {
  if (result.error) throw apiError(result.error, result.response, fallback);
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) throw new IngestApiError('Control Plane trả về dữ liệu ingest không hợp lệ.');
  return parsed.data;
}
function apiError(value: unknown, response: Response, fallback: string) {
  const problem = value as { code?: unknown; detail?: unknown };
  return new IngestApiError(
    typeof problem.detail === 'string' ? problem.detail : fallback,
    typeof problem.code === 'string' ? problem.code : undefined,
    getSafeRequestId(value, response.headers.get('X-Request-Id')),
  );
}
