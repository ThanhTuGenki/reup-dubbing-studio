import { describe, expect, expectTypeOf, it } from 'vitest';
import type { QueueAction, QueueJob, QueueJobDetail } from '../src';

describe('Queue contract', () => {
  it('exposes safe projections and explicit action capabilities', () => {
    expectTypeOf<QueueJob['actions']>().toEqualTypeOf<{ canRetry: boolean; canCancel: boolean }>();
    expectTypeOf<QueueJobDetail['tasks'][number]['progressPercent']>().toEqualTypeOf<number>();
    const action: QueueAction = { reason: 'Retry after operator review' };
    expect(action).not.toHaveProperty('inputManifest');
    expect(action).not.toHaveProperty('credential');
  });
});
