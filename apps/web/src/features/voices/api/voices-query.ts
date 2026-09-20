import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import type { VoiceProfileStatus } from '@reup-dubbing-studio/api-client';
import { fetchVoice, fetchVoices } from './voices-api';

export type VoiceQueryFilters = { query: string; status: VoiceProfileStatus | 'ALL'; language: string; tag: string; commercial: 'ALL' | 'YES' | 'NO' };
export const voiceKeys = { all: ['voices'] as const, list: (filters: VoiceQueryFilters) => ['voices', 'list', filters] as const, detail: (id: string) => ['voices', 'detail', id] as const };
export const voicesQuery = (filters: VoiceQueryFilters) => infiniteQueryOptions({
  queryKey: voiceKeys.list(filters), queryFn: ({ pageParam, signal }) => fetchVoices({ limit: 50, ...(filters.query ? { query: filters.query } : {}), ...(filters.status !== 'ALL' ? { status: filters.status } : {}), ...(filters.language ? { language: filters.language } : {}), ...(filters.tag ? { tag: filters.tag } : {}), ...(filters.commercial !== 'ALL' ? { commercialUseAllowed: filters.commercial === 'YES' } : {}), ...(pageParam ? { cursor: pageParam } : {}) }, signal),
  initialPageParam: '' as string, getNextPageParam: (page) => page.nextCursor ?? undefined, staleTime: 15_000,
});
export const voiceDetailQuery = (id: string) => queryOptions({ queryKey: voiceKeys.detail(id), queryFn: ({ signal }) => fetchVoice(id, signal) });
