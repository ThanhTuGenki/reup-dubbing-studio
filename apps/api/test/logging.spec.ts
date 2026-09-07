import pino from 'pino';

import {
  createRequestContext,
  runWithRequestContext,
  setBusinessContext,
} from '../src/common/context/request-context';
import { loggingOptions } from '../src/common/logging';

function testLogger(output: string[]): pino.Logger {
  const options = { ...loggingOptions().pinoHttp };
  delete options.transport;
  return pino(options, { write: (line: string) => output.push(line) });
}

describe('structured logging', () => {
  it('adds business context through AsyncLocalStorage without passing fields to log calls', () => {
    const output: string[] = [];
    const logger = testLogger(output);

    runWithRequestContext(createRequestContext('request-1'), () => {
      setBusinessContext({ taskId: 't1', attempt: 2 });
      logger.info('task milestone');
    });

    const record = JSON.parse(output[0] ?? '{}') as Record<string, unknown>;
    expect(record).toMatchObject({ requestId: 'request-1', taskId: 't1', attempt: 2 });
    expect(record.msg).toBe('task milestone');
  });

  it('redacts authorization and sensitive key names', () => {
    const output: string[] = [];
    const logger = testLogger(output);

    logger.info(
      {
        req: {
          method: 'GET',
          url: '/download?X-Amz-Signature=secret123',
          headers: { authorization: 'Bearer secret123', cookie: 'sid=secret123' },
        },
        token: 'secret123',
        password: 'secret123',
      },
      'request received',
    );

    expect(output[0]).not.toContain('secret123');
    expect(output[0]).toContain('[Redacted]');
  });

  it('uses newline-delimited JSON in production', () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const output: string[] = [];
    const logger = testLogger(output);
    logger.info('production line');
    process.env.NODE_ENV = previousEnvironment;

    expect(() => JSON.parse(output[0] ?? '')).not.toThrow();
  });
});
