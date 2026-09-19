import type {
  ConnectionTestResult,
  ContentAgentProvider,
  SettingsPatch,
  SettingsView,
} from '../domain/settings';

export type EncryptedCredential = { payload: Uint8Array; hint: string; keyVersion: number };
export type StoredCredential = { payload: Uint8Array; keyVersion: number };

export interface SettingsRepository {
  get(): Promise<SettingsView>;
  update(input: {
    expectedVersion: number;
    idempotencyKey: string;
    requestHash: string;
    patch: SettingsPatch;
    contentAgentCredential?: EncryptedCredential | null;
    storageCredential?: EncryptedCredential | null;
  }): Promise<SettingsView>;
  getContentAgentCredential(): Promise<StoredCredential | null>;
  getStorageCredential(): Promise<StoredCredential | null>;
}

export interface CredentialCipher {
  encrypt(value: unknown): EncryptedCredential;
  decrypt<T>(credential: StoredCredential): T;
}

export interface ContentAgentProbe {
  test(input: { provider: ContentAgentProvider; model: string; apiKey: string }): Promise<ConnectionTestResult>;
}

export interface StorageProbe {
  test(input: {
    accountId: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  }): Promise<ConnectionTestResult>;
}
