import { describe, expectTypeOf, it } from 'vitest';
import type { Dashboard, DashboardAttentionItem } from '../src';

describe('Dashboard contract', () => {
  it('keeps operational counts, decimal cost and safe navigation explicit', () => {
    expectTypeOf<Dashboard['timezone']>().toEqualTypeOf<'Asia/Ho_Chi_Minh'>();
    expectTypeOf<Dashboard['cost']['estimatedCostCp']>().toEqualTypeOf<string>();
    expectTypeOf<Dashboard['cost']['estimatedCostVnd']>().toEqualTypeOf<string | null>();
    expectTypeOf<DashboardAttentionItem>().not.toHaveProperty('credential');
    expectTypeOf<DashboardAttentionItem>().not.toHaveProperty('objectKey');
  });
});
