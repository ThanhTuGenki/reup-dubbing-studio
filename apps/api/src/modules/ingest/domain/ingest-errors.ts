export type IngestErrorCode =
  | 'INGEST_VALIDATION_FAILED'
  | 'INGEST_NO_CREATABLE_ITEMS'
  | 'IDEMPOTENCY_KEY_REUSED';

export class IngestError extends Error {
  constructor(readonly code: IngestErrorCode, message: string) {
    super(message);
    this.name = 'IngestError';
  }
}
