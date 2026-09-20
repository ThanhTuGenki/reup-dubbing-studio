export const SOURCE_PLATFORMS = ['DOUYIN', 'BILIBILI', 'YOUTUBE'] as const;
export const DISCOVERY_MODES = ['JINGXUAN', 'CATEGORY', 'COURSE', 'CREATOR', 'MIX', 'SEARCH_VIDEO', 'SEARCH_USER', 'VIDEO_URL', 'WATCHLIST'] as const;
export const ENABLED_DISCOVERY_MODES = ['JINGXUAN', 'CATEGORY', 'COURSE', 'CREATOR', 'WATCHLIST'] as const;
export const CONTENT_TYPES = ['VIDEO', 'LONG_VIDEO', 'NOTE', 'SLIDES', 'ARTICLE', 'LIVE', 'UNKNOWN'] as const;
export const AVAILABILITIES = ['AVAILABLE', 'PRIVATE', 'REMOVED', 'REGION_BLOCKED', 'UNKNOWN'] as const;
export const WATCHLIST_STATUSES = ['ACTIVE', 'PAUSED', 'CREDENTIAL_REQUIRED', 'FAILED'] as const;

export type SourcePlatform = typeof SOURCE_PLATFORMS[number];
export type DiscoveryMode = typeof DISCOVERY_MODES[number];
export type ContentType = typeof CONTENT_TYPES[number];
export type Availability = typeof AVAILABILITIES[number];
export type WatchlistStatus = typeof WATCHLIST_STATUSES[number];

export type CreateSourceAccount = { platform: SourcePlatform; displayName: string };
export type CreateRun = { sourceAccountId: string; mode: DiscoveryMode; input?: string; query?: string; categoryId?: string; requestedLimit?: number };
export type CreateWatchlist = { sourceAccountId: string; mode: 'CREATOR'; input: string; displayName: string; scheduleIntervalMin: number };
export type UpdateWatchlist = { displayName?: string; status?: WatchlistStatus; scheduleIntervalMin?: number };
export type DiscoveryItemQuery = { runId?: string; categoryId?: string; creatorId?: string; contentType?: ContentType; availability?: Availability; ingestEligible?: boolean; cursor?: string; limit: number };

export type NormalizedMedia = { role: 'COVER' | 'COVER_169' | 'ORIGIN_COVER' | 'PLAYBACK' | 'PLAYBACK_H265' | 'AUDIO' | 'OTHER'; url: string; codec?: string; container?: string; width?: number; height?: number };
export type NormalizedContent = {
  externalId: string;
  creator?: { externalId: string; externalSecureId?: string; nickname?: string; avatarUrl?: string; profileUrl?: string };
  contentType: ContentType;
  externalTypeCode?: string;
  title?: string;
  description?: string;
  canonicalUrl?: string;
  publishedAt?: Date;
  durationMs?: number;
  width?: number;
  height?: number;
  availability: Availability;
  isIngestEligible: boolean;
  metrics?: { playCount?: string | null; diggCount?: string | null; commentCount?: string | null; collectCount?: string | null; shareCount?: string | null; forwardCount?: string | null };
  media?: NormalizedMedia[];
};
