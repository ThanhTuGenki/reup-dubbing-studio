import { queryOptions } from '@tanstack/react-query';

import { fetchSettings } from './settings-api';

export const settingsQueryKey = ['settings'] as const;

export const settingsQuery = () => queryOptions({
  queryKey: settingsQueryKey,
  queryFn: ({ signal }) => fetchSettings(signal),
  staleTime: 30_000,
});
