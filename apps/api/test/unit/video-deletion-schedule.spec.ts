import { MAX_DELETION_ATTEMPTS, nextDeletionSchedule } from '../../src/modules/video-deletion/domain/video-deletion';

describe('nextDeletionSchedule', () => {
  const now = new Date('2026-09-27T10:00:00.000Z');
  const minutes = (failed: number) => (nextDeletionSchedule(failed, now).nextAttemptAt!.getTime() - now.getTime()) / 60_000;

  it('backs off 1, 5, 15 then 60 minutes', () => {
    expect([1, 2, 3, 4, 5].map(minutes)).toEqual([1, 5, 15, 60, 60]);
    expect(nextDeletionSchedule(5, now).status).toBe('DELETING');
  });

  it('gives up on the sixth failure', () => {
    expect(MAX_DELETION_ATTEMPTS).toBe(6);
    expect(nextDeletionSchedule(6, now)).toEqual({ status: 'DELETE_FAILED', nextAttemptAt: null });
    expect(nextDeletionSchedule(9, now).status).toBe('DELETE_FAILED');
  });
});
