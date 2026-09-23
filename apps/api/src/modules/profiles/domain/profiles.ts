export type ProfileStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type VoiceMode = 'SINGLE' | 'DUAL' | 'MULTI_AUTO';
export type TimingPolicy = 'PRESERVE_SEGMENT' | 'FIT_SEGMENT' | 'ALLOW_DRIFT';
export type PublishingPlatform = 'YOUTUBE' | 'FACEBOOK';
export type Readiness = 'READY' | 'NEEDS_CONFIGURATION';

export type PipelineConfig = {
  targetLanguage: string;
  defaultVoiceProfileId: string | null;
  voiceMode: VoiceMode;
  subtitleLanguage: string;
  subtitleFilenameRule: string;
  subtitleMaxLineLength: number | null;
  ttsSpeed: number;
  timingPolicy: TimingPolicy;
  removeHardSubEnabled: boolean;
  output16x9Enabled: boolean;
  output9x16Enabled: boolean;
};

export type ContentConfig = {
  voiceRules: Record<string, unknown>;
  ctaTemplate: string | null;
  metadataTemplate: Record<string, unknown>;
  baseKeywords: string[];
};

export type DestinationInput = {
  platform: PublishingPlatform;
  externalId?: string | null;
  displayName: string;
  isRequired: boolean;
  isActive: boolean;
  platformConfig: Record<string, unknown>;
};

export type DestinationView = DestinationInput & { id: string; version: number };

export type ProfileAssetView = {
  linkId: string;
  assetId: string;
  role: 'INTRO' | 'OUTRO' | 'LOGO' | 'WATERMARK' | 'MASK_REFERENCE_FRAME';
  fileName: string;
  contentType: string | null;
  byteSize: string | null;
  width: number | null;
  height: number | null;
  revision: number;
};

export type ChannelProfileView = {
  id: string;
  name: string;
  status: ProfileStatus;
  pipeline: PipelineConfig;
  content: ContentConfig;
  destinations: DestinationView[];
  assets: ProfileAssetView[];
  readiness: Readiness;
  readinessIssues: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type SeriesOverrides = {
  targetLanguage: string | null;
  defaultVoiceProfileId: string | null;
  voiceMode: VoiceMode | null;
  subtitleLanguage: string | null;
  subtitleFilenameRule: string | null;
  subtitleMaxLineLength: number | null;
  ttsSpeed: number | null;
  timingPolicy: TimingPolicy | null;
  removeHardSubEnabled: boolean | null;
  output16x9Enabled: boolean | null;
  output9x16Enabled: boolean | null;
};

export type SubtitleMask = { x: number; y: number; width: number; height: number };

export type SeriesProfileView = {
  id: string;
  channelProfileId: string;
  name: string;
  status: ProfileStatus;
  overrides: SeriesOverrides;
  effectiveConfig: PipelineConfig;
  inheritance: Record<keyof PipelineConfig, 'CHANNEL' | 'SERIES'>;
  mask: SubtitleMask | null;
  assets: ProfileAssetView[];
  readiness: Readiness;
  readinessIssues: string[];
  version: number;
  parentVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateChannelProfile = {
  name: string;
  pipeline: PipelineConfig;
  content: ContentConfig;
  destinations: DestinationInput[];
};

export type UpdateChannelProfile = {
  name?: string;
  status?: Exclude<ProfileStatus, 'ARCHIVED'>;
  pipeline?: Partial<PipelineConfig>;
  content?: Partial<ContentConfig>;
  destinations?: DestinationInput[];
};

export type CreateSeriesProfile = {
  channelProfileId: string;
  name: string;
  overrides?: Partial<SeriesOverrides>;
  mask?: SubtitleMask | null;
};

export type UpdateSeriesProfile = {
  name?: string;
  status?: Exclude<ProfileStatus, 'ARCHIVED'>;
  overrides?: Partial<SeriesOverrides>;
  mask?: SubtitleMask | null;
};

export type ProfileList<T> = { items: T[]; nextCursor: string | null };
export type ProfileListQuery = {
  cursor?: string;
  limit: number;
  query?: string;
  status?: ProfileStatus;
  readiness?: Readiness;
  channelProfileId?: string;
};

export type ProfileAssetSnapshot = ProfileAssetView & {
  assetVersion: number;
  storageBackend: 'LOCAL' | 'R2' | 'S3';
  bucket: string | null;
  objectKey: string;
  checksumSha256: string | null;
};

export type ProfileJobSnapshot = {
  schemaVersion: 2;
  profile: {
    channelProfileId: string;
    channelProfileVersion: number;
    seriesProfileId: string | null;
    seriesProfileVersion: number | null;
  };
  pipeline: PipelineConfig;
  content: ContentConfig;
  mask: SubtitleMask | null;
  assets: ProfileAssetSnapshot[];
  destinations: DestinationView[];
  defaultVoice: {
    profileId: string;
    version: number;
    sampleLinkId: string;
    sampleAssetId: string;
    sampleRevision: number;
    sampleLanguage: string;
    requestedLanguage: string;
    usedCrossLingualFallback: boolean;
    assetVersion: number;
    objectKey: string;
    checksumSha256: string | null;
  };
  retention: {
    settingsVersion: number;
    rawVideoDays: number;
    intermediateDays: number;
    taskLogDays: number;
    finalOutputDays: number;
  };
  reviewPolicy: {
    schemaVersion: 1;
    channelPolicyVersion: number;
    seriesPolicyVersion: number | null;
    effective: {
      castGate: 'MANUAL_REQUIRED' | 'NOT_REQUIRED';
      scriptGate: 'MANUAL_REQUIRED' | 'NOT_REQUIRED';
      ttsGate: 'MANUAL_REQUIRED' | 'NOT_REQUIRED';
      renderGate: 'MANUAL_REQUIRED' | 'NOT_REQUIRED';
      publishContentGate: 'MANUAL_REQUIRED' | 'NOT_REQUIRED';
      autoRequestRender: boolean;
    };
  };
};
