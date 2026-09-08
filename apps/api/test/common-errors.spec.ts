import type { ArgumentsHost, LoggerService } from '@nestjs/common';

import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  UpstreamError,
  ValidationError,
} from '../src/common/errors';

describe('domain errors', () => {
  it.each([
    [ValidationError, 400, 'VALIDATION_ERROR'],
    [UnauthorizedError, 401, 'UNAUTHORIZED'],
    [ForbiddenError, 403, 'FORBIDDEN'],
    [NotFoundError, 404, 'NOT_FOUND'],
    [ConflictError, 409, 'VERSION_CONFLICT'],
    [UpstreamError, 503, 'UPSTREAM_UNAVAILABLE'],
  ])('%p has status %p and code %p', (ErrorClass, status, code) => {
    const error = new ErrorClass();
    expect(error).toBeInstanceOf(DomainError);
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
  });
});

function hostFor(url = '/test') {
  const sent: { status?: number; type?: string; body?: unknown } = {};
  const response = {
    type(value: string) {
      sent.type = value;
      return this;
    },
    status(value: number) {
      sent.status = value;
      return this;
    },
    send(value: unknown) {
      sent.body = value;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ url, headers: {} }) }),
  } as unknown as ArgumentsHost;
  return { host, sent };
}

describe('ProblemDetailsFilter', () => {
  let ProblemDetailsFilter: typeof import('../src/common/problem-details.filter').ProblemDetailsFilter;

  beforeAll(async () => {
    ({ ProblemDetailsFilter } = await import('../src/common/problem-details.filter'));
  });

  it('maps each domain error to Problem Details', () => {
    const logger: LoggerService = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
    const filter = new ProblemDetailsFilter(logger);
    for (const error of [
      new ValidationError(),
      new UnauthorizedError(),
      new ForbiddenError(),
      new NotFoundError(),
      new ConflictError(),
      new UpstreamError(),
    ]) {
      const { host, sent } = hostFor();
      filter.catch(error, host);
      expect(sent.status).toBe(error.status);
      expect((sent.body as { code: string }).code).toBe(error.code);
      expect((sent.body as { requestId: string }).requestId).toBe('unknown');
    }
  });

  it('maps Prisma codes and hides unknown error messages', () => {
    const logger: LoggerService = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
    const filter = new ProblemDetailsFilter(logger);
    for (const [code, status] of [
      ['P2002', 409],
      ['P2003', 409],
      ['P2025', 404],
    ] as const) {
      const { host, sent } = hostFor();
      filter.catch({ code, message: 'database secret' }, host);
      expect(sent.status).toBe(status);
      expect((sent.body as { detail: string }).detail).not.toContain('database secret');
    }
    const { host, sent } = hostFor();
    filter.catch(new Error('db password is x'), host);
    expect(sent.status).toBe(500);
    expect(JSON.stringify(sent.body)).not.toContain('db password');
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(Error),
      expect.stringContaining('Unhandled'),
    );
  });
});
