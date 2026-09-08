import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface BusinessContext {
  userId?: string;
  workerId?: string;
  videoId?: string;
  jobId?: string;
  taskId?: string;
  attempt?: number;
}

export interface RequestContext extends BusinessContext {
  requestId: string;
  traceId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function createRequestContext(requestId?: string): RequestContext {
  return {
    requestId: requestId?.trim() || randomUUID(),
    traceId: randomUUID(),
  };
}

export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return storage.run(context, callback);
}

export function getRequestContext(): Readonly<RequestContext> | undefined {
  return storage.getStore();
}

export function setBusinessContext(context: BusinessContext): void {
  const current = storage.getStore();
  if (current) Object.assign(current, context);
}
