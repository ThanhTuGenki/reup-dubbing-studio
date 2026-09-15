import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  createClient,
  getReadiness,
  type ProblemDetails,
  type SuccessEnvelope,
} from '../src';

describe('generated health contract', () => {
  it('exports readiness through the generated fetch client', async () => {
    const payload: SuccessEnvelope = {
      data: { status: 'ok' },
      meta: { requestId: '0191f3d2-7f5b-7abc-8b2e-123456789abd' },
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = createClient({ baseUrl: 'http://localhost:3000/v1', fetch });

    const result = await getReadiness({ client });

    expect(fetch).toHaveBeenCalledOnce();
    expect(result.data).toEqual(payload);
  });

  it('exports envelope and Problem Details types from the package boundary', () => {
    expectTypeOf<SuccessEnvelope['data']['status']>().toEqualTypeOf<'ok'>();
    expectTypeOf<ProblemDetails['code']>().toEqualTypeOf<
      'VALIDATION_ERROR' | 'ROUTE_NOT_FOUND' | 'RATE_LIMITED' | 'INTERNAL_ERROR'
    >();
  });
});
