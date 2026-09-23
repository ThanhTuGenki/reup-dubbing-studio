import {
  createClient,
  getDashboard,
  type Dashboard,
  type DashboardEnvelope,
} from '@reup-dubbing-studio/api-client';

import { getSafeRequestId } from '@/shared/api/problem-details';
import { readRuntimeConfig } from '@/shared/config/runtime-config';

export class DashboardApiError extends Error {
  override readonly name = 'DashboardApiError';

  constructor(
    message: string,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

export async function fetchDashboard(signal?: AbortSignal): Promise<Dashboard> {
  const result = await getDashboard({
    client: createClient({ baseUrl: readRuntimeConfig().controlPlaneUrl }),
    signal: requestSignal(signal),
  });

  if (result.error) {
    const problem = result.error as { code?: unknown; detail?: unknown };
    throw new DashboardApiError(
      typeof problem.detail === 'string' ? problem.detail : 'Không thể tải tổng quan vận hành.',
      typeof problem.code === 'string' ? problem.code : undefined,
      getSafeRequestId(result.error, result.response.headers.get('X-Request-Id')),
    );
  }

  const envelope = result.data as DashboardEnvelope | undefined;
  if (!envelope?.data) {
    throw new DashboardApiError('Control Plane không trả về dữ liệu Dashboard.');
  }

  return envelope.data;
}

function requestSignal(signal?: AbortSignal) {
  if (!signal) return null;
  try {
    new Request('about:blank', { signal });
    return signal;
  } catch {
    return null;
  }
}
