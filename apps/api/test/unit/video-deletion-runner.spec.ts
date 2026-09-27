import { VideoDeletionRunner } from '../../src/modules/video-deletion/application/video-deletion-runner';

describe('VideoDeletionRunner.tick error containment', () => {
  it('resolves (does not reject) when the repository claimNext rejects, and clears the busy flag for the next poll', async () => {
    const repository = { claimNext: jest.fn().mockRejectedValue(new Error('DB down')) };
    const runner = new VideoDeletionRunner(repository as never, {} as never, false);

    await expect(runner.tick()).resolves.toBeUndefined();
    // A stuck 'active' flag would make every later tick a silent no-op; prove the next poll still tries.
    await runner.tick();
    expect(repository.claimNext).toHaveBeenCalledTimes(2);
  });

  it('resolves (does not reject) when recordFailure itself rejects after a processing failure', async () => {
    const repository = {
      claimNext: jest.fn().mockResolvedValue({ id: 'video-1', attempts: 0, graceUntil: null }),
      assetsToPurge: jest.fn().mockRejectedValue(new Error('boom')),
      recordFailure: jest.fn().mockRejectedValue(new Error('DB down again')),
    };
    const runner = new VideoDeletionRunner(repository as never, {} as never, false);

    await expect(runner.tick()).resolves.toBeUndefined();
    expect(repository.recordFailure).toHaveBeenCalledWith('video-1', 0, 'DELETION_FAILED', expect.any(Date));
  });
});
