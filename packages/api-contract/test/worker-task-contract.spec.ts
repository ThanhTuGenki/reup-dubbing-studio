import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  claimWorkerTask,
  commitWorkerTaskOutput,
  completeWorkerTaskAttempt,
  failWorkerTaskAttempt,
  refreshWorkerTaskInputGrant,
  renewWorkerTaskLease,
  reportWorkerTaskProgress,
  requestWorkerTaskOutputGrant,
  startWorkerTaskAttempt,
  type ClaimTaskEnvelope,
  type ClaimedTask,
  type CompleteTaskRequest,
  type HeartbeatEnvelope,
  type TaskConfiguration,
  type WorkerProblemCode,
} from '../src/worker';

describe('generated Worker task contract', () => {
  it('publishes the complete lease and output lifecycle', () => {
    expect(claimWorkerTask).toBeTypeOf('function');
    expect(startWorkerTaskAttempt).toBeTypeOf('function');
    expect(renewWorkerTaskLease).toBeTypeOf('function');
    expect(reportWorkerTaskProgress).toBeTypeOf('function');
    expect(refreshWorkerTaskInputGrant).toBeTypeOf('function');
    expect(requestWorkerTaskOutputGrant).toBeTypeOf('function');
    expect(commitWorkerTaskOutput).toBeTypeOf('function');
    expect(completeWorkerTaskAttempt).toBeTypeOf('function');
    expect(failWorkerTaskAttempt).toBeTypeOf('function');
  });

  it('keeps task payloads versioned, fenced and discriminated by configuration kind', () => {
    expectTypeOf<ClaimedTask['payloadVersion']>().toEqualTypeOf<1>();
    expectTypeOf<ClaimedTask['fencingToken']>().toEqualTypeOf<string>();
    expectTypeOf<TaskConfiguration['kind']>().toEqualTypeOf<
      | 'DESUB'
      | 'TRANSCRIBE_OCR'
      | 'TRANSCRIBE_ASR'
      | 'GENERATE_INITIAL_TTS'
      | 'REGENERATE_SEGMENT'
      | 'SEPARATE_AUDIO'
      | 'RENDER'
    >();
    expectTypeOf<ClaimTaskEnvelope['data']['task']>().toEqualTypeOf<ClaimedTask | null>();
    expectTypeOf<CompleteTaskRequest['outputs'][number]>().toHaveProperty('assetId');
  });

  it('carries drain and cancellation signals without exposing storage credentials', () => {
    expectTypeOf<HeartbeatEnvelope['data']['desiredStatus']>().toEqualTypeOf<
      'ACTIVE' | 'DRAINING' | 'REVOKED'
    >();
    expectTypeOf<HeartbeatEnvelope['data']['cancelLeaseIds']>().toEqualTypeOf<string[]>();
    expectTypeOf<ClaimedTask>().not.toHaveProperty('objectKey');
    expectTypeOf<ClaimedTask>().not.toHaveProperty('storageCredential');
    expectTypeOf<Extract<WorkerProblemCode, 'STALE_TASK_ATTEMPT'>>().toEqualTypeOf<
      'STALE_TASK_ATTEMPT'
    >();
  });
});
