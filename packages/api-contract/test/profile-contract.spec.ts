import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  createClient,
  listChannelProfiles,
  previewSeriesProfileAsset,
  type ChannelProfileEnvelope,
  type PreviewGrant,
  type SeriesProfile,
} from '../src';

describe('generated Profile contract', () => {
  it('uses cursor filters and the generated response envelope', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { items: [], nextCursor: null }, meta: { requestId: '01994429-ec00-7000-8000-000000000030' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    const client = createClient({ baseUrl: 'http://localhost:3000/v1', fetch });
    const result = await listChannelProfiles({ client, query: { status: 'DRAFT', limit: 20 } });
    expect(result.data && 'data' in result.data ? result.data.data.items : null).toEqual([]);
    expect((fetch.mock.calls[0]?.[0] as Request).url).toContain('status=DRAFT');
  });

  it('keeps resolved and inherited shapes required at the package boundary', () => {
    expectTypeOf<ChannelProfileEnvelope['data']>().toHaveProperty('pipeline');
    expectTypeOf<SeriesProfile['overrides']['targetLanguage']>().toEqualTypeOf<string | null>();
    expectTypeOf<SeriesProfile['inheritance']['targetLanguage']>().toEqualTypeOf<'CHANNEL' | 'SERIES'>();
    expectTypeOf<PreviewGrant['method']>().toEqualTypeOf<'GET'>();
    expect(previewSeriesProfileAsset).toBeTypeOf('function');
  });
});
