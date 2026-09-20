import { queryOptions } from '@tanstack/react-query';
import { fetchWorker, fetchWorkerImages, fetchWorkers } from './workers-api';

export const workerKeys = { all: ['workers'] as const, list: () => [...workerKeys.all, 'list'] as const, detail: (id: string) => [...workerKeys.all, 'detail', id] as const, images: () => [...workerKeys.all, 'images'] as const };
export const workersQuery = () => queryOptions({ queryKey: workerKeys.list(), queryFn: ({ signal }) => fetchWorkers(signal) });
export const workerQuery = (id: string) => queryOptions({ queryKey: workerKeys.detail(id), queryFn: ({ signal }) => fetchWorker(id, signal) });
export const workerImagesQuery = () => queryOptions({ queryKey: workerKeys.images(), queryFn: ({ signal }) => fetchWorkerImages(signal), staleTime: 60_000 });
