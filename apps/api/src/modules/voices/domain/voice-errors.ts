export type VoiceErrorCode = 'VOICE_NOT_FOUND' | 'VOICE_NAME_CONFLICT' | 'VOICE_VERSION_CONFLICT'
  | 'VOICE_VALIDATION_FAILED' | 'VOICE_NOT_READY' | 'VOICE_ARCHIVED' | 'VOICE_IN_USE'
  | 'VOICE_SAMPLE_NOT_AVAILABLE';

export class VoiceError extends Error {
  constructor(readonly code: VoiceErrorCode, message: string) { super(message); this.name = 'VoiceError'; }
}
