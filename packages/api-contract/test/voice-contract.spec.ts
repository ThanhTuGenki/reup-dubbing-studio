import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  createClient,
  listVoiceProfiles,
  previewVoiceSample,
  type CommittedVoiceSample,
  type VoiceProfile,
  type VoiceProfileListEnvelope,
} from '../src';

describe('generated Voice Library contract', () => {
  it('uses cursor filters and the generated response envelope', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { items: [], nextCursor: null }, meta: { requestId: '01994429-ec00-7000-8000-000000000034' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    const client = createClient({ baseUrl: 'http://localhost:3000/v1', fetch });
    const result = await listVoiceProfiles({ client, query: { status: 'READY', language: 'vi', commercialUseAllowed: true } });
    expect(result.data && 'data' in result.data ? result.data.data.items : null).toEqual([]);
    const url = (fetch.mock.calls[0]?.[0] as Request).url;
    expect(url).toContain('status=READY');
    expect(url).toContain('commercialUseAllowed=true');
  });

  it('keeps voice, sample and readiness shapes at the package boundary', () => {
    expectTypeOf<VoiceProfileListEnvelope['data']['items'][number]>().toEqualTypeOf<VoiceProfile>();
    expectTypeOf<VoiceProfile['status']>().toEqualTypeOf<'DRAFT' | 'READY' | 'BLOCKED_LICENSE' | 'ARCHIVED'>();
    expectTypeOf<CommittedVoiceSample['sample']>().toHaveProperty('assetId');
    expect(previewVoiceSample).toBeTypeOf('function');
  });
});
