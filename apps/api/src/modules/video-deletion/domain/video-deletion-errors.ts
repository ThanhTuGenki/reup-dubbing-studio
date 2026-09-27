export type VideoDeletionErrorCode =
  | 'VIDEO_NOT_FOUND' | 'VIDEO_VERSION_CONFLICT' | 'VIDEO_HAS_PUBLICATION_HISTORY' | 'VIDEO_DELETION_VALIDATION_FAILED'
  | 'IDEMPOTENCY_KEY_REUSED' | 'STORAGE_NOT_CONFIGURED' | 'STORAGE_BUCKET_MISMATCH' | 'STORAGE_DELETE_FAILED';
export class VideoDeletionError extends Error { constructor(readonly code: VideoDeletionErrorCode, message: string) { super(message); this.name = 'VideoDeletionError'; } }
