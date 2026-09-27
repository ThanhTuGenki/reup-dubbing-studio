export const DELETION_GRACE_MS = 15 * 60_000;
export const DELETION_LEASE_MS = 5 * 60_000;
export const MAX_DELETION_ATTEMPTS = 6;
const BACKOFF_MINUTES = [1, 5, 15, 60] as const;

export type BulkDeletionResult = 'ACCEPTED' | 'ALREADY_DELETING' | 'HAS_PUBLICATION_HISTORY' | 'VERSION_CONFLICT' | 'NOT_FOUND';
export type VideoDeletionEnvelope = { videoId: string; status: 'DELETING' | 'DELETE_FAILED'; cancelledJobIds: string[] };
export type DeletionOutcome = { result: BulkDeletionResult; envelope: VideoDeletionEnvelope | null };

/** Schedule after the Nth consecutive failure; the sixth failure stops retrying. */
export function nextDeletionSchedule(
  failedAttempts: number,
  now: Date,
): { status: 'DELETING' | 'DELETE_FAILED'; nextAttemptAt: Date | null } {
  if (failedAttempts >= MAX_DELETION_ATTEMPTS) return { status: 'DELETE_FAILED', nextAttemptAt: null };
  const delay = BACKOFF_MINUTES[Math.min(Math.max(failedAttempts, 1), BACKOFF_MINUTES.length) - 1]!;
  return { status: 'DELETING', nextAttemptAt: new Date(now.getTime() + delay * 60_000) };
}
