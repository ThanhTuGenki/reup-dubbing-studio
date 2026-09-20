import type { ProfileObjectStore } from '../../src/modules/profiles/application/asset-ports';
import { ProfileError } from '../../src/modules/profiles/domain/profile-errors';
import type { VoiceRepository, VoiceSampleRepository } from '../../src/modules/voices/application/ports';
import { VoiceSamplesService } from '../../src/modules/voices/application/voice-samples.service';
import { VoicesService } from '../../src/modules/voices/application/voices.service';
import type { CreateVoiceProfile, PendingVoiceSample } from '../../src/modules/voices/domain/voices';

const voice: CreateVoiceProfile = {
  name: 'Narrator', primaryLanguage: 'vi', description: null, tags: ['warm'],
  licenseKind: 'OWNED_RECORDING', licenseReference: null, sourceReference: null,
  commercialUseAllowed: true,
};

describe('VoicesService', () => {
  it('enforces the commercial license matrix before persistence', async () => {
    const repository = { create: jest.fn() } as unknown as VoiceRepository;
    const service = new VoicesService(repository);
    expect(() => service.create({ ...voice, licenseKind: 'UNKNOWN' }, 'key')).toThrow('This license cannot allow commercial use');
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('uses a stable request hash for equivalent nested input', async () => {
    const repository = { create: jest.fn().mockResolvedValue({}) } as unknown as VoiceRepository;
    const service = new VoicesService(repository);
    await service.create(voice, 'key-1');
    await service.create({ ...voice, tags: [...voice.tags] }, 'key-2');
    expect((repository.create as jest.Mock).mock.calls[0][2]).toBe((repository.create as jest.Mock).mock.calls[1][2]);
  });
});

describe('VoiceSamplesService', () => {
  const pending: PendingVoiceSample = {
    id: '01994429-ec00-7000-8000-000000000040', bucket: 'voices', objectKey: 'voices/sample.wav',
    language: 'vi', transcript: 'Xin chào', durationMs: 5000, fileName: 'sample.wav',
    contentType: 'audio/wav', byteSize: 128,
  };

  it('does not commit when HEAD metadata differs from the grant', async () => {
    const repository = {
      replayCommit: jest.fn().mockResolvedValue(null), getPending: jest.fn().mockResolvedValue(pending),
      commit: jest.fn(),
    } as unknown as VoiceSampleRepository;
    const store = { inspect: jest.fn().mockResolvedValue({ byteSize: 129, contentType: 'audio/wav' }) } as unknown as ProfileObjectStore;
    const service = new VoiceSamplesService(repository, store);
    await expect(service.commit('voice-id', pending.id, 1, 'request-id')).rejects.toMatchObject({ code: 'VOICE_SAMPLE_NOT_AVAILABLE' });
    expect(repository.commit).not.toHaveBeenCalled();
  });

  it('replays a committed response without inspecting object storage again', async () => {
    const replay = { sample: { id: 'sample-id' }, profileVersion: 2 };
    const repository = { replayCommit: jest.fn().mockResolvedValue(replay) } as unknown as VoiceSampleRepository;
    const store = { inspect: jest.fn() } as unknown as ProfileObjectStore;
    const service = new VoiceSamplesService(repository, store);
    await expect(service.commit('voice-id', pending.id, 1, 'request-id')).resolves.toEqual(replay);
    expect(store.inspect).not.toHaveBeenCalled();
  });

  it('maps shared storage failures into the Voice error boundary', async () => {
    const repository = { getAvailable: jest.fn().mockResolvedValue(pending) } as unknown as VoiceSampleRepository;
    const store = { createPreviewGrant: jest.fn().mockRejectedValue(new ProfileError('PROFILE_ASSET_NOT_AVAILABLE', 'R2 unavailable')) } as unknown as ProfileObjectStore;
    const service = new VoiceSamplesService(repository, store);
    await expect(service.preview('voice-id', 'sample-id')).rejects.toMatchObject({ code: 'VOICE_SAMPLE_NOT_AVAILABLE', message: 'R2 unavailable' });
  });

  it.each([
    [{ ...pending, durationMs: 2999 }, 'Sample duration'],
    [{ ...pending, contentType: 'audio/ogg' }, 'Unsupported sample content type'],
    [{ ...pending, checksumSha256: 'not-a-checksum' }, 'Invalid sample checksum'],
  ])('rejects invalid sample authorization metadata', async (input, message) => {
    const repository = { createPending: jest.fn() } as unknown as VoiceSampleRepository;
    const store = { target: jest.fn() } as unknown as ProfileObjectStore;
    const service = new VoiceSamplesService(repository, store);
    await expect(service.requestUpload('voice-id', input)).rejects.toThrow(message);
    expect(store.target).not.toHaveBeenCalled();
  });
});
