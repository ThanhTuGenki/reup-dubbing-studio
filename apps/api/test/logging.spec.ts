import pino from 'pino';

import {
  createRequestContext,
  runWithRequestContext,
  setBusinessContext,
} from '../src/common/context/request-context';
import { loggingOptions, redactRequest } from '../src/common/logging';

function testLogger(output: string[]): pino.Logger {
  const options = { ...loggingOptions().pinoHttp };
  delete (options as { transport?: unknown }).transport;
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

  it.each([
    ['accessToken', 'ACCESS_TOKEN_SENTINEL'],
    ['client_secret', 'CLIENT_SECRET_SENTINEL'],
    ['APIKEY', 'APIKEY_SENTINEL'],
    ['password', 'DEEP_PASSWORD_SENTINEL'],
  ])('redacts %s at arbitrary depth', (key, sentinel) => {
    const output: string[] = [];
    const logger = testLogger(output);

    logger.info(
      {
        nested: {
          [key]: sentinel,
          one: { two: { three: { four: { [key]: sentinel } } } },
          array: [{ safe: 'visible', [key]: sentinel }],
        },
        downloadUrl: 'https://example.invalid/object?X-Amz-Signature=URL_QUERY_SENTINEL',
      },
      'request received',
    );

    expect(output[0]).not.toContain(sentinel);
    expect(output[0]).not.toContain('URL_QUERY_SENTINEL');
    expect(output[0]).toContain('[Redacted]');
    expect(output[0]).toContain('visible');
  });

  it('redacts credentials on an actual request record', () => {
    const output: string[] = [];
    const logger = testLogger(output);

    logger.info(
      {
        req: {
          method: 'GET',
          url: '/health',
          headers: { authorization: 'Bearer AUTHORIZATION_SENTINEL', cookie: 'COOKIE_SENTINEL' },
        },
      },
      'request received',
    );

    expect(output[0]).not.toContain('AUTHORIZATION_SENTINEL');
    expect(output[0]).not.toContain('COOKIE_SENTINEL');
    expect(output[0]).toMatch(/authorization.*\[Redacted\]/);
    expect(output[0]).toMatch(/cookie.*\[Redacted\]/);
  });

  it('redacts credentials from the request serializer used by pino-http', () => {
    const record = redactRequest({
      method: 'GET',
      url: '/health',
      headers: { authorization: 'Bearer AUTHORIZATION_SENTINEL', cookie: 'COOKIE_SENTINEL' },
    });

    expect(JSON.stringify(record)).toContain('[Redacted]');
    expect(JSON.stringify(record)).not.toContain('AUTHORIZATION_SENTINEL');
    expect(JSON.stringify(record)).not.toContain('COOKIE_SENTINEL');
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
