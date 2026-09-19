import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import type { ProfileStatus } from '@reup-dubbing-studio/api-client';

import {
  fetchChannelProfile,
  fetchChannelProfiles,
  fetchSeriesProfile,
  fetchSeriesProfiles,
} from './profiles-api';

export type ProfileFilters = { query: string; status: ProfileStatus | 'ALL'; channelProfileId?: string };

export const profileKeys = {
  all: ['profiles'] as const,
  channels: (filters: ProfileFilters) => [...profileKeys.all, 'channels', filters] as const,
  channel: (id: string) => [...profileKeys.all, 'channel', id] as const,
  seriesList: (filters: ProfileFilters) => [...profileKeys.all, 'series-list', filters] as const,
  series: (id: string) => [...profileKeys.all, 'series', id] as const,
};

export const channelsQuery = (filters: ProfileFilters) => infiniteQueryOptions({
  queryKey: profileKeys.channels(filters),
  queryFn: ({ pageParam, signal }) => fetchChannelProfiles({
    limit: 50, ...(filters.query ? { query: filters.query } : {}),
    ...(filters.status !== 'ALL' ? { status: filters.status } : {}),
    ...(pageParam ? { cursor: pageParam } : {}),
  }, signal),
  initialPageParam: '' as string,
  getNextPageParam: (page) => page.nextCursor ?? undefined,
  staleTime: 15_000,
});

export const seriesListQuery = (filters: ProfileFilters) => infiniteQueryOptions({
  queryKey: profileKeys.seriesList(filters),
  queryFn: ({ pageParam, signal }) => fetchSeriesProfiles({
    limit: 50, ...(filters.query ? { query: filters.query } : {}),
    ...(filters.status !== 'ALL' ? { status: filters.status } : {}),
    ...(filters.channelProfileId ? { channelProfileId: filters.channelProfileId } : {}),
    ...(pageParam ? { cursor: pageParam } : {}),
  }, signal),
  initialPageParam: '' as string,
  getNextPageParam: (page) => page.nextCursor ?? undefined,
  staleTime: 15_000,
});

export const channelDetailQuery = (id: string) => queryOptions({
  queryKey: profileKeys.channel(id), queryFn: ({ signal }) => fetchChannelProfile(id, signal),
});
export const seriesDetailQuery = (id: string) => queryOptions({
  queryKey: profileKeys.series(id), queryFn: ({ signal }) => fetchSeriesProfile(id, signal),
});
