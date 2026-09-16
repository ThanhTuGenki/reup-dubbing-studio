import { queryOptions } from '@tanstack/react-query';
import { checkReadiness } from '../../../shared/api/control-plane';
import { readRuntimeConfig } from '../../../shared/config/runtime-config';

export const readinessQuery = () => queryOptions({
  queryKey: ['control-plane', 'readiness'],
  queryFn: ({ signal }) => checkReadiness({ baseUrl: readRuntimeConfig().controlPlaneUrl, signal }),
  retry: false,
});
