import type { Settings, SettingsPatch } from '@reup-dubbing-studio/api-client';

export type SettingsDraft = {
  provider: Settings['contentAgent']['provider'];
  model: string;
  contentSecret: string;
  clearContentSecret: boolean;
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  clearStorageSecret: boolean;
  rawVideoDays: string;
  intermediateDays: string;
  taskLogDays: string;
  finalOutputDays: string;
};

export type FormErrors = Partial<Record<keyof SettingsDraft, string>>;

export function draftFromSettings(settings: Settings): SettingsDraft {
  return {
    provider: settings.contentAgent.provider,
    model: settings.contentAgent.model,
    contentSecret: '',
    clearContentSecret: false,
    accountId: settings.storage.accountId,
    bucket: settings.storage.bucket,
    accessKeyId: '',
    secretAccessKey: '',
    clearStorageSecret: false,
    rawVideoDays: String(settings.retention.rawVideoDays),
    intermediateDays: String(settings.retention.intermediateDays),
    taskLogDays: String(settings.retention.taskLogDays),
    finalOutputDays: String(settings.retention.finalOutputDays),
  };
}

export function isDirty(settings: Settings, draft: SettingsDraft): boolean {
  return JSON.stringify(draftFromSettings(settings)) !== JSON.stringify(draft);
}

export function validateForSave(settings: Settings, draft: SettingsDraft): FormErrors {
  const errors: FormErrors = {};
  const contentChanged = draft.provider !== settings.contentAgent.provider
    || draft.model !== settings.contentAgent.model || Boolean(draft.contentSecret) || draft.clearContentSecret;
  if (contentChanged && !/^[A-Za-z0-9._:/-]{1,128}$/u.test(draft.model)) errors.model = 'Nhập model hợp lệ.';

  const storageChanged = draft.accountId !== settings.storage.accountId || draft.bucket !== settings.storage.bucket
    || Boolean(draft.accessKeyId) || Boolean(draft.secretAccessKey) || draft.clearStorageSecret;
  if (storageChanged && !/^[a-fA-F0-9]{32}$/u.test(draft.accountId)) errors.accountId = 'Account ID phải gồm 32 ký tự hex.';
  if (storageChanged && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(draft.bucket)) errors.bucket = 'Tên bucket không hợp lệ.';
  if (Boolean(draft.accessKeyId) !== Boolean(draft.secretAccessKey)) {
    errors.accessKeyId = errors.secretAccessKey = 'Cần nhập đủ Access Key ID và Secret Access Key.';
  }
  validateDays(draft.rawVideoDays, 365, 'rawVideoDays', errors);
  validateDays(draft.intermediateDays, 90, 'intermediateDays', errors);
  validateDays(draft.taskLogDays, 365, 'taskLogDays', errors);
  validateDays(draft.finalOutputDays, 3650, 'finalOutputDays', errors);
  return errors;
}

export function buildPatch(settings: Settings, draft: SettingsDraft): SettingsPatch {
  const patch: SettingsPatch = {};
  const contentAgent: NonNullable<SettingsPatch['contentAgent']> = {};
  if (draft.provider !== settings.contentAgent.provider) contentAgent.provider = draft.provider;
  if (draft.model !== settings.contentAgent.model) contentAgent.model = draft.model;
  if (draft.contentSecret) contentAgent.credential = { action: 'REPLACE', value: draft.contentSecret };
  else if (draft.clearContentSecret) contentAgent.credential = { action: 'CLEAR' };
  if (Object.keys(contentAgent).length) patch.contentAgent = contentAgent;

  const storage: NonNullable<SettingsPatch['storage']> = {};
  if (draft.accountId !== settings.storage.accountId) storage.accountId = draft.accountId;
  if (draft.bucket !== settings.storage.bucket) storage.bucket = draft.bucket;
  if (draft.accessKeyId && draft.secretAccessKey) {
    storage.credential = { action: 'REPLACE', value: { accessKeyId: draft.accessKeyId, secretAccessKey: draft.secretAccessKey } };
  } else if (draft.clearStorageSecret) storage.credential = { action: 'CLEAR' };
  if (Object.keys(storage).length) patch.storage = storage;

  const retention: NonNullable<SettingsPatch['retention']> = {};
  for (const key of ['rawVideoDays', 'intermediateDays', 'taskLogDays', 'finalOutputDays'] as const) {
    const value = Number(draft[key]);
    if (value !== settings.retention[key]) retention[key] = value;
  }
  if (Object.keys(retention).length) patch.retention = retention;
  return patch;
}

function validateDays(value: string, max: number, key: keyof SettingsDraft, errors: FormErrors) {
  const parsed = Number(value);
  if (!/^\d+$/u.test(value) || !Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    errors[key] = `Nhập số ngày từ 1 đến ${max}.`;
  }
}
