export type SettingsErrorCode =
  | 'SETTINGS_NOT_CONFIGURED'
  | 'SETTINGS_VALIDATION_FAILED'
  | 'CONNECTION_TEST_FAILED'
  | 'VERSION_CONFLICT';

export class SettingsError extends Error {
  constructor(
    readonly code: SettingsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SettingsError';
  }
}
