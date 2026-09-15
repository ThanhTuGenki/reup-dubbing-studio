import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

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

/** RFC 9562 UUID v7: 48-bit Unix epoch milliseconds plus cryptographic randomness. */
function uuidV7(): string {
  const bytes = randomBytes(16);
  let timestamp = BigInt(Date.now());

  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }

  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
