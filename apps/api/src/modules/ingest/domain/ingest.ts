export const INGEST_DISPOSITIONS = [
  'READY', 'READY_RETRY', 'ALREADY_QUEUED', 'ALREADY_INGESTED',
  'SOURCE_NOT_FOUND', 'SOURCE_UNAVAILABLE', 'SOURCE_NOT_INGEST_ELIGIBLE',
  'SOURCE_ACCOUNT_UNAVAILABLE', 'SOURCE_CREDENTIAL_REQUIRED', 'PROFILE_NOT_READY',
  'SERIES_NOT_READY', 'SERIES_CHANNEL_MISMATCH', 'VIDEO_PROFILE_CONFLICT',
] as const;

export type IngestDisposition = typeof INGEST_DISPOSITIONS[number];

export type IngestSelection = {
  sourceAccountId: string;
  sourceContentIds: string[];
  channelProfileId: string;
  seriesProfileId?: string | null;
};

export type IngestPreflightItem = {
  sourceContentId: string;
  disposition: IngestDisposition;
  existingVideoId: string | null;
  existingJobId: string | null;
  issues: string[];
};

export type IngestPreflight = {
  summary: { total: number; ready: number; blocked: number };
  items: IngestPreflightItem[];
};

export type IngestCreateItem = {
  sourceContentId: string;
  result: 'CREATED' | 'ALREADY_QUEUED' | 'ALREADY_INGESTED' | 'SKIPPED_INVALID';
  videoId: string | null;
  jobId: string | null;
  taskId: string | null;
  jobStatus: 'QUEUED' | null;
  videoStatus: string | null;
  issues: string[];
};

export type IngestCreateResult = {
  items: IngestCreateItem[];
  summary: { total: number; created: number; reused: number; skipped: number };
};
