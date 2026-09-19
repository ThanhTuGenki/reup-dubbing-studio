export type ContentAgentProvider = 'ANTHROPIC' | 'OPENAI';
export type StorageBackend = 'R2';

export type CredentialView = {
  configured: boolean;
  hint: string | null;
  rotatedAt: string | null;
};

export type SettingsView = {
  version: number;
  contentAgent: {
    provider: ContentAgentProvider;
    model: string;
    credential: CredentialView;
  };
  storage: {
    backend: StorageBackend;
    accountId: string;
    bucket: string;
    credential: CredentialView;
  };
  retention: {
    rawVideoDays: number;
    intermediateDays: number;
    taskLogDays: number;
    finalOutputDays: number;
  };
};

export type SecretCommand =
  | { action: 'REPLACE'; value: string }
  | { action: 'CLEAR' };

export type SettingsPatch = {
  contentAgent?: { provider?: ContentAgentProvider; model?: string; credential?: SecretCommand };
  storage?: {
    backend?: StorageBackend;
    accountId?: string;
    bucket?: string;
    credential?: ({ action: 'REPLACE'; value: { accessKeyId: string; secretAccessKey: string } } | { action: 'CLEAR' });
  };
  retention?: Partial<SettingsView['retention']>;
};

export type ConnectionTestResult = {
  status: 'CONNECTED';
  latencyMs: number;
  checkedAt: string;
  message: string;
};
