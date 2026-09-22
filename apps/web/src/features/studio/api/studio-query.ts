import { queryOptions } from '@tanstack/react-query';

import { fetchStudio } from './studio-api';

export const studioKeys = { all: ['studio'] as const, detail: (videoId: string) => [...studioKeys.all, videoId] as const };
export const studioQuery = (videoId: string) => queryOptions({
  queryKey: studioKeys.detail(videoId),
  queryFn: () => fetchStudio(videoId),
  refetchInterval: ({ state }) => {
    const studio = state.data;
    return studio?.video.status === 'PROCESSING' || studio?.segments.some((segment) => segment.revision?.preview?.status === 'GENERATING') ? 3_000 : false;
  },
});
