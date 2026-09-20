import { createHash } from 'node:crypto';
import type { QueueAction, QueueFilters } from '../domain/queue';
import { QueueError } from '../domain/queue-errors';
import type { PrismaQueueRepository } from '../infrastructure/prisma-queue-repository';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export class QueueService {
  constructor(private readonly repository: PrismaQueueRepository) {}
  list(filters: QueueFilters) { validateFilters(filters); return this.repository.list(filters); }
  detail(id: string) { return this.repository.detail(jobId(id)); }
  attempts(id: string, cursor?: string, limit?: number) { return this.repository.attempts(jobId(id), cursor, limit); }
  events() { return this.repository.events(); }
  cancel(id: string, version: number, key: string, body: QueueAction, requestId?: string) { const normalizedId = jobId(id); return this.repository.cancel(normalizedId, version, idempotencyKey(key), requestHash(normalizedId, version, body), safe(body.reason), requestId); }
  retry(id: string, version: number, key: string, body: QueueAction, requestId?: string) {
    if (body.taskId) jobId(body.taskId);
    const normalizedId = jobId(id);
    return this.repository.retry(normalizedId, version, idempotencyKey(key), requestHash(normalizedId, version, body), body.taskId, safe(body.reason), requestId);
  }
}
const allowed = {
  status: new Set(['QUEUED', 'RUNNING', 'WAITING_FOR_GPU', 'WAITING_FOR_REVIEW', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
  kind: new Set(['INGEST', 'FULL_PIPELINE', 'RERENDER', 'REGENERATE_CONTENT']),
  resourceClass: new Set(['IO', 'CPU', 'GPU_BATCH', 'GPU_TTS_INTERACTIVE', 'CONTROL_PLANE', 'HUMAN_REVIEW']),
};
function validateFilters(filters: QueueFilters) {
  for (const key of ['status', 'kind', 'resourceClass'] as const) {
    const values = filters[key]?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
    if (values.some((value) => !allowed[key].has(value))) throw new QueueError('QUEUE_VALIDATION_FAILED', `Invalid Queue ${key} filter`);
  }
  if (filters.channelProfileId) jobId(filters.channelProfileId);
  const createdFrom = dateFilter(filters.createdFrom, 'createdFrom');
  const createdTo = dateFilter(filters.createdTo, 'createdTo');
  if (createdFrom && createdTo && createdFrom > createdTo) throw new QueueError('QUEUE_VALIDATION_FAILED', 'createdFrom must not be after createdTo');
}
function dateFilter(value: string | undefined, name: string) { if (!value) return null; const parsed = new Date(value); if (Number.isNaN(parsed.valueOf()) || !value.endsWith('Z')) throw new QueueError('QUEUE_VALIDATION_FAILED', `${name} must be an ISO 8601 UTC timestamp`); return parsed; }
function jobId(value: string) { if (!UUID_V7.test(value)) throw new QueueError('QUEUE_VALIDATION_FAILED', 'ID must be UUID v7'); return value; }
function idempotencyKey(value: string) { if (!/^[\x21-\x7e]{8,128}$/u.test(value)) throw new QueueError('QUEUE_VALIDATION_FAILED', 'Idempotency-Key must contain 8 to 128 visible ASCII characters'); return value; }
function safe(value?: string) { if (!value) return null; return Array.from(value, (character) => { const code = character.charCodeAt(0); return code < 32 || code === 127 ? ' ' : character; }).join('').trim().slice(0, 500) || null; }
function requestHash(jobIdValue: string, version: number, value: QueueAction) { return createHash('sha256').update(JSON.stringify({ jobId: jobIdValue, version, reason: safe(value.reason), taskId: value.taskId ?? null })).digest('hex'); }
