import { queryOptions } from '@tanstack/react-query';

import { fetchDashboard } from './dashboard-api';

export const dashboardKeys = {
  all: ['dashboard'] as const,
  projection: () => [...dashboardKeys.all, 'projection'] as const,
};

export const dashboardQuery = () => queryOptions({
  queryKey: dashboardKeys.projection(),
  queryFn: ({ signal }) => fetchDashboard(signal),
  refetchInterval: 30_000,
});
