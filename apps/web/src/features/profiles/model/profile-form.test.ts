import { describe, expect, it } from 'vitest';
import { buildSeriesUpdate, emptySeriesDraft, validateSeriesDraft } from './profile-form';

describe('profile form model', () => {
  it('rejects a mask that extends outside normalized frame bounds', () => {
    const draft = { ...emptySeriesDraft('0191f3d2-7f5b-7abc-8b2e-123456789ac0'), name: 'Series', removeHardSubEnabled: true, maskEnabled: true, maskX: '0.7', maskWidth: '0.4' };
    expect(validateSeriesDraft(draft).mask).toMatch(/0–1/u);
  });

  it('defaults hard-sub removal to off and only requires a mask when enabled', () => {
    const draft = { ...emptySeriesDraft('0191f3d2-7f5b-7abc-8b2e-123456789ac0'), name: 'Series' };
    expect(draft.removeHardSubEnabled).toBe(false);
    expect(validateSeriesDraft(draft).mask).toBeUndefined();
    expect(validateSeriesDraft({ ...draft, removeHardSubEnabled: true }).mask).toMatch(/mask/u);
  });

  it('writes null for inherited fields and values only for overrides', () => {
    const draft = { ...emptySeriesDraft('0191f3d2-7f5b-7abc-8b2e-123456789ac0'), name: 'Series', overridden: new Set(['ttsSpeed', 'removeHardSubEnabled', 'output9x16Enabled'] as const), ttsSpeed: '1.15', removeHardSubEnabled: true, output9x16Enabled: true };
    expect(buildSeriesUpdate(draft).overrides).toMatchObject({ targetLanguage: null, ttsSpeed: 1.15, removeHardSubEnabled: true, output9x16Enabled: true });
  });
});
