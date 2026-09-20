import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { fetchVideo, fetchVideos, type LibraryFilters } from './library-api';
export const libraryKeys = { all: ['library'] as const, lists: () => [...libraryKeys.all, 'list'] as const, list: (filters: Omit<LibraryFilters, 'cursor'>) => [...libraryKeys.lists(), filters] as const, detail: (id: string) => [...libraryKeys.all, 'detail', id] as const };
export const libraryVideosQuery = (filters: Omit<LibraryFilters, 'cursor'>) => infiniteQueryOptions({ queryKey: libraryKeys.list(filters), initialPageParam: undefined as string | undefined, queryFn: ({ pageParam, signal }) => fetchVideos({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) }, signal), getNextPageParam: (page) => page.nextCursor ?? undefined });
export const libraryVideoQuery = (id: string) => queryOptions({ queryKey: libraryKeys.detail(id), queryFn: ({ signal }) => fetchVideo(id, signal) });
