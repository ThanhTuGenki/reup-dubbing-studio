import { randomUUID } from 'node:crypto';

import {
  createRequestContext,
  requestContextStorage,
  type RequestContext,
} from '../../src/platform/observability/request-context';

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('request context', () => {
  it('creates a server-owned UUID v7 and does not trust an inbound request id', () => {
    const inboundRequestId = randomUUID();
    const context = createRequestContext({
      inboundRequestId,
      method: 'GET',
      route: '/v1/health/live',
    });

    expect(context.requestId).toMatch(UUID_V7_PATTERN);
    expect(context.requestId).not.toBe(inboundRequestId);
    expect(context.method).toBe('GET');
    expect(context.route).toBe('/v1/health/live');
    expect(context.startedAt).toBeInstanceOf(Date);
  });

  it('keeps the same context available through nested asynchronous work', async () => {
    const context = createRequestContext({
      method: 'GET',
      route: '/v1/health/ready',
    });

    await requestContextStorage.run(context, async () => {
      expect(requestContextStorage.getStore()).toBe(context);

      await Promise.resolve();

      expect(requestContextStorage.getStore()).toBe(context);
    });

    expect(requestContextStorage.getStore()).toBeUndefined();
  });

  it('does not allow an inbound id to replace the generated context id', () => {
    const inboundRequestId = 'client-controlled-id';
    const context: RequestContext = createRequestContext({
      inboundRequestId,
      method: 'POST',
      route: '/v1/example',
    });

    requestContextStorage.run(context, () => {
      expect(requestContextStorage.getStore()?.requestId).not.toBe(inboundRequestId);
    });
  });
});
