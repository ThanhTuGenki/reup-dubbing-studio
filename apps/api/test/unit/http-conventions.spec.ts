import {
  BadRequestException,
  NotFoundException,
  StreamableFile,
  type ArgumentsHost,
  type ExecutionContext,
} from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';

import { ProblemDetailsFilter } from '../../src/platform/http/problem-details.filter';
import { SuccessEnvelopeInterceptor } from '../../src/platform/http/success-envelope.interceptor';

type ResponseRecorder = {
  statusCode?: number;
  contentType?: string;
  body?: unknown;
  headers: Record<string, string>;
  type: (value: string) => ResponseRecorder;
  status: (value: number) => ResponseRecorder;
  header: (name: string, value: string) => ResponseRecorder;
  send: (value: unknown) => ResponseRecorder;
};

function responseRecorder(): ResponseRecorder {
  const response: ResponseRecorder = {
    headers: {},
    type(value) {
      response.contentType = value;
      return response;
    },
    status(value) {
      response.statusCode = value;
      return response;
    },
    header(name, value) {
      response.headers[name] = value;
      return response;
    },
    send(value) {
      response.body = value;
      return response;
    },
  };
  return response;
}

function executionContext(response: ResponseRecorder, statusCode = 200): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ requestId: '018f0f2a-7b3c-7abc-8def-1234567890ab' }),
      getResponse: () => ({ ...response, statusCode }),
    }),
  } as unknown as ExecutionContext;
}

function argumentsHost(
  response: ResponseRecorder,
  requestId = '018f0f2a-7b3c-7abc-8def-1234567890ab',
  url = '/v1/test',
) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        id: requestId,
        requestId,
        method: 'GET',
        url,
      }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
}

describe('HTTP conventions', () => {
  describe('SuccessEnvelopeInterceptor', () => {
    it('wraps a JSON success payload with data and request metadata', async () => {
      const interceptor = new SuccessEnvelopeInterceptor();
      const response = responseRecorder();
      const context = executionContext(response);
      const result = await lastValueFrom(
        interceptor.intercept(context, { handle: () => of({ status: 'ok' }) }),
      );

      expect(result).toEqual({
        data: { status: 'ok' },
        meta: { requestId: '018f0f2a-7b3c-7abc-8def-1234567890ab' },
      });
    });

    it('does not create a body for a 204 response', async () => {
      const interceptor = new SuccessEnvelopeInterceptor();
      const response = responseRecorder();
      const payload = { status: 'ignored-for-204' };
      const result = await lastValueFrom(
        interceptor.intercept(executionContext(response, 204), { handle: () => of(payload) }),
      );

      expect(result).toBe(payload);
      expect(response.body).toBeUndefined();
    });

    it('does not wrap StreamableFile responses', async () => {
      const interceptor = new SuccessEnvelopeInterceptor();
      const response = responseRecorder();
      const payload = new StreamableFile(Buffer.from('file-content'));
      const result = await lastValueFrom(
        interceptor.intercept(executionContext(response), { handle: () => of(payload) }),
      );

      expect(result).toBe(payload);
    });
  });

  describe('ProblemDetailsFilter', () => {
    it.each([
      [new BadRequestException('name is required'), 400, 'VALIDATION_ERROR'],
      [new NotFoundException(), 404, 'ROUTE_NOT_FOUND'],
    ] as const)('maps an HTTP exception to RFC 9457 (%s)', (exception, status, code) => {
      const filter = new ProblemDetailsFilter();
      const response = responseRecorder();

      filter.catch(exception, argumentsHost(response));

      expect(response.statusCode).toBe(status);
      expect(response.contentType).toBe('application/problem+json');
      expect(response.body).toMatchObject({
        type: expect.any(String),
        title: expect.any(String),
        status,
        instance: '/v1/test',
        code,
        requestId: '018f0f2a-7b3c-7abc-8def-1234567890ab',
      });
      expect(response.body).not.toHaveProperty('data');
    });

    it('maps an unknown exception to a safe internal problem detail', () => {
      const filter = new ProblemDetailsFilter();
      const response = responseRecorder();
      const secret = 'database-password-sentinel';

      filter.catch(new Error(`internal failure: ${secret}`), argumentsHost(response));

      expect(response.statusCode).toBe(500);
      expect(response.contentType).toBe('application/problem+json');
      expect(response.body).toMatchObject({
        type: expect.any(String),
        title: expect.any(String),
        instance: '/v1/test',
        status: 500,
        code: 'INTERNAL_ERROR',
        requestId: '018f0f2a-7b3c-7abc-8def-1234567890ab',
      });
      expect(JSON.stringify(response.body)).not.toContain(secret);
    });

    it('strips query strings from the problem instance path', () => {
      const filter = new ProblemDetailsFilter();
      const response = responseRecorder();

      filter.catch(
        new NotFoundException(),
        argumentsHost(response, undefined, '/v1/test?token=query-secret#fragment'),
      );

      expect(response.body).toMatchObject({ instance: '/v1/test' });
      expect(JSON.stringify(response.body)).not.toContain('query-secret');
    });
  });
});
