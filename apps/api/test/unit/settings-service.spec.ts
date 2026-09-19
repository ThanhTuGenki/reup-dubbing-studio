import type {
  ContentAgentProbe,
  CredentialCipher,
  SettingsRepository,
  StorageProbe,
} from '../../src/modules/settings/application/ports';
import { SettingsService } from '../../src/modules/settings/application/settings.service';
import type { SettingsError } from '../../src/modules/settings/domain/settings-errors';

describe('SettingsService', () => {
  const repository = {
    get: jest.fn(), update: jest.fn(),
    getContentAgentCredential: jest.fn(), getStorageCredential: jest.fn(),
  } as jest.Mocked<SettingsRepository>;
  const cipher = { encrypt: jest.fn(), decrypt: jest.fn() } as jest.Mocked<CredentialCipher>;
  const contentProbe = { test: jest.fn() } as jest.Mocked<ContentAgentProbe>;
  const storageProbe = { test: jest.fn() } as jest.Mocked<StorageProbe>;
  const service = new SettingsService(repository, cipher, contentProbe, storageProbe);

  beforeEach(() => jest.clearAllMocks());

  it('preserves omitted credentials and encrypts an explicit replacement', async () => {
    const encrypted = { payload: new Uint8Array([1]), hint: 'hint', keyVersion: 1 };
    cipher.encrypt.mockReturnValue(encrypted);
    repository.update.mockResolvedValue({ version: 2 } as never);

    await service.update(1, '01994429-ec00-7000-8000-000000000002', {
      contentAgent: { credential: { action: 'REPLACE', value: 'api-secret' } },
      retention: { rawVideoDays: 14 },
    });

    expect(cipher.encrypt).toHaveBeenCalledWith({ apiKey: 'api-secret' });
    expect(repository.update).toHaveBeenCalledWith(expect.objectContaining({
      contentAgentCredential: encrypted,
    }));
    expect(repository.update.mock.calls[0]?.[0]).not.toHaveProperty('storageCredential');
  });

  it('does not call a probe when stored credentials are absent', async () => {
    repository.getContentAgentCredential.mockResolvedValue(null);

    await expect(service.testContentAgent({
      provider: 'ANTHROPIC', model: 'claude-test', credential: { source: 'STORED' },
    })).rejects.toEqual(expect.objectContaining<Partial<SettingsError>>({ code: 'SETTINGS_NOT_CONFIGURED' }));
    expect(contentProbe.test).not.toHaveBeenCalled();
  });
});
