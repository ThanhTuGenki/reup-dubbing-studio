export type VoiceStatus = 'DRAFT' | 'READY' | 'BLOCKED_LICENSE' | 'ARCHIVED';
export type VoiceLicenseKind = 'OWNED_RECORDING' | 'AUTHORIZED_COMMERCIAL' | 'CC_BY' | 'CC_BY_NC' | 'CUSTOM' | 'UNKNOWN';

export type VoiceSampleView = {
  id: string; assetId: string; language: string; transcript: string; durationMs: number;
  fileName: string; contentType: string; byteSize: string; revision: number;
};

export type VoiceProfileView = {
  id: string; name: string; primaryLanguage: string; description: string | null; tags: string[];
  status: VoiceStatus; licenseKind: VoiceLicenseKind; licenseReference: string | null;
  sourceReference: string | null; commercialUseAllowed: boolean;
  samples: VoiceSampleView[]; readiness: 'READY' | 'NEEDS_CONFIGURATION'; readinessIssues: string[];
  referencedBy: { channelProfiles: number; seriesProfiles: number };
  version: number; createdAt: string; updatedAt: string;
};

export type CreateVoiceProfile = Omit<VoiceProfileView, 'id' | 'status' | 'samples' | 'readiness' | 'readinessIssues' | 'referencedBy' | 'version' | 'createdAt' | 'updatedAt'>;
export type UpdateVoiceProfile = Partial<CreateVoiceProfile>;
export type VoiceListQuery = { cursor?: string; limit: number; query?: string; status?: VoiceStatus; language?: string; tag?: string; commercialUseAllowed?: boolean };
export type VoiceList = { items: VoiceProfileView[]; nextCursor: string | null };
export type RequestVoiceSampleUpload = {
  language: string; transcript: string; durationMs: number; fileName: string;
  contentType: string; byteSize: number; checksumSha256?: string;
};
export type PendingVoiceSample = RequestVoiceSampleUpload & { id: string; bucket: string; objectKey: string };
