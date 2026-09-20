import { describe, expectTypeOf, it } from 'vitest';
import type { CreateWorker, Worker, WorkerImage } from '../src';

describe('GPU Worker Web contract', () => {
  it('exposes safe registry projections without bearer credentials', () => {
    expectTypeOf<Worker['observedStatus']>().toEqualTypeOf<'PENDING' | 'READY' | 'BUSY' | 'DRAINING' | 'SAFE_TO_TERMINATE' | 'OFFLINE' | 'TERMINATED' | 'ERROR'>();
    expectTypeOf<Worker['activeLeaseCount']>().toEqualTypeOf<number>();
    expectTypeOf<WorkerImage['imageDigest']>().toEqualTypeOf<string>();
    expectTypeOf<CreateWorker['hourlyRateCp']>().toEqualTypeOf<string>();
  });
});
