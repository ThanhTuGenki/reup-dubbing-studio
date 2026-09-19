import { describe, expect, it } from 'vitest';

import { settingsEnvelope } from '../../../test/fixtures/control-plane';
import { buildPatch, draftFromSettings, validateForSave } from './settings-form';

describe('Settings form model', () => {
  const settings = settingsEnvelope.data;

  it('never hydrates plaintext credentials from a Settings response', () => {
    const draft = draftFromSettings(settings);

    expect(draft.contentSecret).toBe('');
    expect(draft.accessKeyId).toBe('');
    expect(draft.secretAccessKey).toBe('');
  });

  it('creates explicit replace and clear commands without masked placeholders', () => {
    const draft = draftFromSettings(settings);
    draft.contentSecret = 'new-content-secret';
    draft.clearStorageSecret = true;

    expect(buildPatch(settings, draft)).toEqual({
      contentAgent: { credential: { action: 'REPLACE', value: 'new-content-secret' } },
      storage: { credential: { action: 'CLEAR' } },
    });
  });

  it('validates retention and paired R2 credentials before a request is sent', () => {
    const draft = draftFromSettings(settings);
    draft.rawVideoDays = '0';
    draft.accessKeyId = 'access-only';

    expect(validateForSave(settings, draft)).toMatchObject({
      rawVideoDays: expect.any(String), accessKeyId: expect.any(String), secretAccessKey: expect.any(String),
    });
  });
});
