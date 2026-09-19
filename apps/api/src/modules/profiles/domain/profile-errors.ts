export type ProfileErrorCode =
  | 'PROFILE_NAME_CONFLICT'
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_ARCHIVED'
  | 'PROFILE_NOT_READY'
  | 'PROFILE_HAS_ACTIVE_SERIES'
  | 'PROFILE_PARENT_ARCHIVED'
  | 'PROFILE_VERSION_CONFLICT'
  | 'PROFILE_ASSET_NOT_AVAILABLE'
  | 'PROFILE_ASSET_ROLE_INVALID'
  | 'PROFILE_MASK_INVALID'
  | 'PROFILE_VOICE_NOT_READY'
  | 'PROFILE_VALIDATION_FAILED';

export class ProfileError extends Error {
  constructor(readonly code: ProfileErrorCode, message: string) {
    super(message);
    this.name = 'ProfileError';
  }
}
