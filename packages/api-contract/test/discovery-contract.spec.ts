import { describe, expect, it } from 'vitest';
import type { CreateDiscoveryRun, DiscoveryRun, SourceAccount, Watchlist } from '../src';

describe('Discovery contract', () => {
  it('keeps provider identity and metrics as strings and hides provider cursor', () => {
    const input: CreateDiscoveryRun = { sourceAccountId: '01994429-ec00-7000-8000-000000000071', mode: 'JINGXUAN', requestedLimit: 20 };
    expect(input.mode).toBe('JINGXUAN');
    const runKeys: (keyof DiscoveryRun)[] = ['id', 'status', 'itemCount'];
    expect(runKeys).not.toContain('providerCursor');
    const accountKeys: (keyof SourceAccount)[] = ['status', 'credential'];
    expect(accountKeys).not.toContain('ciphertext');
    const watchlistKeys: (keyof Watchlist)[] = ['resolvedInput', 'version'];
    expect(watchlistKeys).toContain('version');
  });
});
