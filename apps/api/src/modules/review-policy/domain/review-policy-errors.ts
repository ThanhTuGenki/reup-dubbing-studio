export type ReviewPolicyErrorCode =
  | 'REVIEW_POLICY_NOT_FOUND'
  | 'REVIEW_POLICY_VALIDATION_FAILED'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED';

export class ReviewPolicyError extends Error {
  constructor(readonly code: ReviewPolicyErrorCode, message: string) {
    super(message);
    this.name = 'ReviewPolicyError';
  }
}
