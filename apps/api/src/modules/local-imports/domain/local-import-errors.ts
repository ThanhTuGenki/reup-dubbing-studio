export type LocalImportErrorCode =
  | 'LOCAL_IMPORT_NOT_FOUND'
  | 'LOCAL_IMPORT_VALIDATION_FAILED'
  | 'LOCAL_IMPORT_NOT_AVAILABLE'
  | 'IDEMPOTENCY_KEY_REUSED';

export class LocalImportError extends Error {
  constructor(readonly code: LocalImportErrorCode, message: string) {
    super(message);
  }
}
