import { describe, expect, it } from 'vitest';
import { buildVoiceCreate, emptyVoiceDraft, validateVoiceDraft } from './voice-form';
describe('Voice form', () => {
  it('normalizes tags and nullable references', () => { const draft = { ...emptyVoiceDraft(), name: ' Narrator ', tags: 'Warm, warm, Story', description: ' ' }; expect(buildVoiceCreate(draft)).toMatchObject({ name: 'Narrator', tags: ['warm', 'story'], description: null }); });
  it('blocks a non-commercial license from commercial use', () => { expect(validateVoiceDraft({ ...emptyVoiceDraft(), name: 'Voice', licenseKind: 'CC_BY_NC' }).commercialUseAllowed).toBeTruthy(); });
});
