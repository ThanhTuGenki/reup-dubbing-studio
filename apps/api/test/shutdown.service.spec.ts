import { HttpAdapterHost } from '@nestjs/core';

import { ShutdownService } from '../src/infra/process/shutdown.service';

describe('ShutdownService', () => {
  it('lets an in-flight request finish and rejects requests after drain starts', () => {
    type Reply = { code: (status: number) => Reply; send: (body: unknown) => void };
    type Hook = (request: unknown, reply: Reply, done: () => void) => void;
    const hooks: Hook[] = [];
    const fastify = { addHook: (_name: string, hook: Hook) => hooks.push(hook) };
    const adapterHost = { httpAdapter: { getInstance: () => fastify } } as unknown as HttpAdapterHost;
    const service = new ShutdownService(adapterHost, {
      NODE_ENV: 'test',
      PORT: 3000,
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      LOG_LEVEL: 'error',
      CORS_ORIGINS: [],
      SHUTDOWN_TIMEOUT_MS: 10_000,
    });
    service.onModuleInit();
    const hook = hooks[0];
    if (!hook) {
      throw new Error('shutdown hook was not registered');
    }

    let oldRequestCompleted = false;
    const oldReply: Reply = { code: () => oldReply, send: () => undefined };
    hook({}, oldReply, () => {
      oldRequestCompleted = true;
    });
    service.beforeApplicationShutdown();

    const reply = { code: jest.fn().mockReturnThis(), send: jest.fn() };
    hook({}, reply, jest.fn());
    service.onApplicationShutdown();

    expect(oldRequestCompleted).toBe(true);
    expect(reply.code).toHaveBeenCalledWith(503);
    expect(reply.send).toHaveBeenCalledWith({ status: 'shutting_down' });
  });
});
