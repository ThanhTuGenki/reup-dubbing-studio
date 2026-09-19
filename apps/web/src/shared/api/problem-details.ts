import { z } from 'zod';

const requestId = z.string().uuid();
const problemDetails = z.object({
  type: z.string(), title: z.string(), status: z.number().int().min(400).max(599), instance: z.string(),
  code: z.enum(['VALIDATION_ERROR', 'ROUTE_NOT_FOUND', 'RATE_LIMITED', 'INTERNAL_ERROR', 'SETTINGS_NOT_CONFIGURED', 'SETTINGS_VALIDATION_FAILED', 'CONNECTION_TEST_FAILED', 'VERSION_CONFLICT']), requestId,
});

export function getSafeRequestId(value: unknown, headerValue?: string | null) {
  const fromBody = problemDetails.safeParse(value);
  if (fromBody.success) return fromBody.data.requestId;
  const fromHeader = requestId.safeParse(headerValue);
  return fromHeader.success ? fromHeader.data : undefined;
}
