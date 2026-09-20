export type QueueErrorCode = 'QUEUE_VALIDATION_FAILED' | 'QUEUE_JOB_NOT_FOUND' | 'QUEUE_CURSOR_INVALID' | 'VERSION_CONFLICT' | 'JOB_NOT_CANCELLABLE' | 'JOB_NOT_RETRYABLE' | 'JOB_RETRY_CONFLICT' | 'IDEMPOTENCY_KEY_REUSED';
export class QueueError extends Error { constructor(readonly code: QueueErrorCode, message: string) { super(message); this.name = 'QueueError'; } }
