import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { fetchPublicationTask, fetchPublicationTasks, type PublicationTaskFilters } from './publishing-api';

export const publishingKeys = {
  all: ['publishing'] as const,
  lists: () => [...publishingKeys.all, 'list'] as const,
  list: (filters: PublicationTaskFilters) => [...publishingKeys.lists(), filters] as const,
  details: () => [...publishingKeys.all, 'detail'] as const,
  detail: (id: string) => [...publishingKeys.details(), id] as const,
};
export const publicationTasksQuery = (filters: PublicationTaskFilters) => infiniteQueryOptions({ queryKey: publishingKeys.list(filters), queryFn: ({ pageParam }) => fetchPublicationTasks({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) }), initialPageParam: undefined as string | undefined, getNextPageParam: (page) => page.nextCursor ?? undefined, refetchInterval: 15_000 });
export const publicationTaskQuery = (id: string) => queryOptions({ queryKey: publishingKeys.detail(id), queryFn: () => fetchPublicationTask(id), refetchInterval: 15_000 });
