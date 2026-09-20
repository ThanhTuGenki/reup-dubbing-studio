import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { fetchQueueAttempts, fetchQueueJob, fetchQueueJobs, type QueueFilters } from './queue-api';

export const queueKeys = { all: ['queue'] as const, lists: () => [...queueKeys.all, 'list'] as const, list: (filters: Omit<QueueFilters, 'cursor'>) => [...queueKeys.lists(), filters] as const, detail: (id: string) => [...queueKeys.all, 'detail', id] as const, attempts: (id: string) => [...queueKeys.detail(id), 'attempts'] as const };
export const queueJobsQuery = (filters: Omit<QueueFilters, 'cursor'>) => infiniteQueryOptions({ queryKey: queueKeys.list(filters), initialPageParam: undefined as string | undefined, queryFn: ({ pageParam, signal }) => fetchQueueJobs({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) }, signal), getNextPageParam: (page) => page.nextCursor ?? undefined });
export const queueJobQuery = (id: string) => queryOptions({ queryKey: queueKeys.detail(id), queryFn: ({ signal }) => fetchQueueJob(id, signal) });
export const queueAttemptsQuery = (id: string) => queryOptions({ queryKey: queueKeys.attempts(id), queryFn: ({ signal }) => fetchQueueAttempts(id, signal) });
