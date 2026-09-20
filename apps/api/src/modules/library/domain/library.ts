export type OutputReadiness = 'NONE' | 'PARTIAL' | 'READY' | 'CLEANED';
export type LibraryFilters = { cursor?: string; limit?: number; status?: string; platform?: string; channelProfileId?: string; seriesProfileId?: string; outputReadiness?: OutputReadiness; updatedFrom?: string; updatedTo?: string; query?: string; includeArchived?: boolean };
export type AssetPart = 'video' | 'subtitle' | 'thumbnail';
export type GrantPurpose = 'preview' | 'download';
