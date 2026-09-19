import type {
  ChannelProfileView,
  CreateChannelProfile,
  CreateSeriesProfile,
  ProfileList,
  ProfileListQuery,
  ProfileJobSnapshot,
  SeriesProfileView,
  UpdateChannelProfile,
  UpdateSeriesProfile,
} from '../domain/profiles';

export interface ProfileRepository {
  listChannels(query: ProfileListQuery): Promise<ProfileList<ChannelProfileView>>;
  getChannel(id: string): Promise<ChannelProfileView>;
  createChannel(input: CreateChannelProfile, idempotencyKey: string, requestHash: string): Promise<ChannelProfileView>;
  updateChannel(id: string, expectedVersion: number, input: UpdateChannelProfile): Promise<ChannelProfileView>;
  archiveChannel(id: string, expectedVersion: number): Promise<ChannelProfileView>;
  restoreChannel(id: string, expectedVersion: number): Promise<ChannelProfileView>;
  listSeries(query: ProfileListQuery): Promise<ProfileList<SeriesProfileView>>;
  getSeries(id: string): Promise<SeriesProfileView>;
  createSeries(input: CreateSeriesProfile, idempotencyKey: string, requestHash: string): Promise<SeriesProfileView>;
  updateSeries(id: string, expectedVersion: number, expectedParentVersion: number, input: UpdateSeriesProfile): Promise<SeriesProfileView>;
  archiveSeries(id: string, expectedVersion: number, expectedParentVersion: number): Promise<SeriesProfileView>;
  restoreSeries(id: string, expectedVersion: number, expectedParentVersion: number): Promise<SeriesProfileView>;
  snapshotForJob(input: { channelProfileId: string; seriesProfileId?: string }): Promise<ProfileJobSnapshot>;
}
