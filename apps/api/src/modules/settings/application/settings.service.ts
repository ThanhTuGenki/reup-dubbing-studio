import { createHash } from 'node:crypto';

import type {
  ConnectionTestResult,
  ContentAgentProvider,
  SettingsPatch,
  SettingsView,
} from '../domain/settings';
import { SettingsError } from '../domain/settings-errors';
import type {
  ContentAgentProbe,
  CredentialCipher,
  SettingsRepository,
  StorageProbe,
} from './ports';

export class SettingsService {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly cipher: CredentialCipher,
    private readonly contentAgentProbe: ContentAgentProbe,
    private readonly storageProbe: StorageProbe,
  ) {}

  get(): Promise<SettingsView> {
    return this.repository.get();
  }

  async update(
    expectedVersion: number,
    idempotencyKey: string,
    patch: SettingsPatch,
  ): Promise<SettingsView> {
    validatePatch(patch);
    const contentCommand = patch.contentAgent?.credential;
    const storageCommand = patch.storage?.credential;
    return this.repository.update({
      expectedVersion,
      idempotencyKey,
      requestHash: createHash('sha256').update(stableStringify({ expectedVersion, patch })).digest('hex'),
      patch,
      ...(contentCommand ? {
        contentAgentCredential: contentCommand.action === 'REPLACE'
          ? this.cipher.encrypt({ apiKey: contentCommand.value }) : null,
      } : {}),
      ...(storageCommand ? {
        storageCredential: storageCommand.action === 'REPLACE'
          ? this.cipher.encrypt(storageCommand.value) : null,
      } : {}),
    });
  }

  async testContentAgent(input: {
    provider: ContentAgentProvider;
    model: string;
    credential: { source: 'STORED' } | { source: 'PROVIDED'; value: string };
  }): Promise<ConnectionTestResult> {
    if (!/^[A-Za-z0-9._:/-]{1,128}$/u.test(input.model)) {
      throw new SettingsError('SETTINGS_VALIDATION_FAILED', 'Invalid Content Agent model');
    }
    let apiKey: string;
    if (input.credential.source === 'PROVIDED') {
      apiKey = input.credential.value;
    } else {
      const stored = await this.repository.getContentAgentCredential();
      if (!stored) throw new SettingsError('SETTINGS_NOT_CONFIGURED', 'Content Agent credential is not configured');
      apiKey = this.cipher.decrypt<{ apiKey: string }>(stored).apiKey;
    }
    return this.contentAgentProbe.test({ provider: input.provider, model: input.model, apiKey });
  }

  async testStorage(input: {
    accountId: string;
    bucket: string;
    credential: { source: 'STORED' } | {
      source: 'PROVIDED';
      value: { accessKeyId: string; secretAccessKey: string };
    };
  }): Promise<ConnectionTestResult> {
    if (!/^[a-fA-F0-9]{32}$/u.test(input.accountId)
      || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(input.bucket)) {
      throw new SettingsError('SETTINGS_VALIDATION_FAILED', 'Invalid R2 target');
    }
    let credentials: { accessKeyId: string; secretAccessKey: string };
    if (input.credential.source === 'PROVIDED') {
      credentials = input.credential.value;
    } else {
      const stored = await this.repository.getStorageCredential();
      if (!stored) throw new SettingsError('SETTINGS_NOT_CONFIGURED', 'Storage credential is not configured');
      credentials = this.cipher.decrypt<typeof credentials>(stored);
    }
    return this.storageProbe.test({ accountId: input.accountId, bucket: input.bucket, ...credentials });
  }
}

function validatePatch(patch: SettingsPatch): void {
  if (Object.keys(patch).length === 0) fail('At least one settings group is required');
  if (patch.contentAgent && Object.keys(patch.contentAgent).length === 0) fail('Content Agent patch cannot be empty');
  if (patch.storage && Object.keys(patch.storage).length === 0) fail('Storage patch cannot be empty');
  if (patch.retention && Object.keys(patch.retention).length === 0) fail('Retention patch cannot be empty');
  const model = patch.contentAgent?.model;
  if (model !== undefined && (!/^[A-Za-z0-9._:/-]{1,128}$/u.test(model))) fail('Invalid Content Agent model');
  const caSecret = patch.contentAgent?.credential;
  if (caSecret?.action === 'REPLACE' && (typeof caSecret.value !== 'string' || !caSecret.value.trim())) fail('Content Agent secret cannot be empty');
  if (caSecret?.action === 'CLEAR' && 'value' in caSecret) fail('CLEAR must not include a secret value');
  const storage = patch.storage;
  if (storage?.accountId !== undefined && !/^[a-fA-F0-9]{32}$/u.test(storage.accountId)) fail('Invalid R2 account ID');
  if (storage?.bucket !== undefined && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(storage.bucket)) fail('Invalid R2 bucket');
  const pair = storage?.credential;
  if (pair?.action === 'REPLACE' && (
    typeof pair.value !== 'object' || pair.value === null
    || typeof pair.value.accessKeyId !== 'string' || !pair.value.accessKeyId.trim()
    || typeof pair.value.secretAccessKey !== 'string' || !pair.value.secretAccessKey.trim()
  )) fail('Storage credential cannot be empty');
  if (pair?.action === 'CLEAR' && 'value' in pair) fail('CLEAR must not include a credential value');
  const limits: Array<[number | undefined, number, number]> = [
    [patch.retention?.rawVideoDays, 1, 365],
    [patch.retention?.intermediateDays, 1, 90],
    [patch.retention?.taskLogDays, 1, 365],
    [patch.retention?.finalOutputDays, 1, 3650],
  ];
  if (limits.some(([value, min, max]) => value !== undefined && (!Number.isInteger(value) || value < min || value > max))) {
    fail('Invalid retention policy');
  }
}

function fail(message: string): never {
  throw new SettingsError('SETTINGS_VALIDATION_FAILED', message);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
