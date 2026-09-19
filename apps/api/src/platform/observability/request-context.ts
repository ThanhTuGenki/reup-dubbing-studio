import { AsyncLocalStorage } from 'node:async_hooks';
import { uuidV7 } from '../ids/uuid-v7';

export type RequestContext = {
  requestId: string;
  method: string;
  route: string;
  startedAt: Date;
};

export type RequestContextInput = {
  inboundRequestId?: string;
  method?: string;
  route?: string;
};

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Creates a context owned by the server. The inbound ID is deliberately ignored:
 * callers may correlate with our response header, but may not control log IDs.
 */
export function createRequestContext(input: RequestContextInput = {}): RequestContext {
  return {
    requestId: uuidV7(),
    method: input.method ?? 'UNKNOWN',
    route: safePath(input.route),
    startedAt: new Date(),
  };
}

export function currentRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

function safePath(route: string | undefined): string {
  return route?.split(/[?#]/u, 1)[0] || '/';
}
