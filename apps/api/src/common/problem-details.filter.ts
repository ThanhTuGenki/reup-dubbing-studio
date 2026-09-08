import { ArgumentsHost, Catch, type ExceptionFilter, type LoggerService } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { getRequestContext } from './context/request-context';
import { ConflictError, DomainError, NotFoundError } from './errors';

type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  requestId: string;
  errors?: unknown;
};

type PrismaError = { code: string; meta?: Record<string, unknown> };

function isPrismaError(exception: unknown): exception is PrismaError {
  return (
    !!exception &&
    typeof exception === 'object' &&
    'code' in exception &&
    typeof (exception as { code?: unknown }).code === 'string' &&
    ['P2002', 'P2025', 'P2003'].includes((exception as { code: string }).code)
  );
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const requestId =
      getRequestContext()?.requestId ?? String(request.headers['x-request-id'] ?? 'unknown');
    const mapped = this.mapException(exception);
    const body: ProblemDetails = {
      type: 'about:blank',
      title: mapped.title,
      status: mapped.status,
      detail: mapped.detail,
      instance: request.url,
      code: mapped.code,
      requestId,
      ...(mapped.errors ? { errors: mapped.errors } : {}),
    };

    if (mapped.status >= 500) {
      this.logger.error(exception, `Unhandled exception [${requestId}]`);
    } else {
      this.logger.warn({ requestId, code: mapped.code, status: mapped.status }, mapped.detail);
    }
    void response.type('application/problem+json').status(mapped.status).send(body);
  }

  private mapException(exception: unknown): {
    status: number;
    code: string;
    title: string;
    detail: string;
    errors?: unknown;
  } {
    if (exception instanceof DomainError) {
      return {
        status: exception.status,
        code: exception.code,
        title: exception.name,
        detail: exception.message,
      };
    }
    if (exception instanceof ZodError) {
      return {
        status: 400,
        code: 'VALIDATION_ERROR',
        title: 'Validation failed',
        detail: 'One or more request fields failed validation.',
        errors: exception.flatten(),
      };
    }
    if (isPrismaError(exception)) {
      if (exception.code === 'P2025')
        return {
          status: 404,
          code: 'NOT_FOUND',
          title: 'Not found',
          detail: 'The requested resource was not found.',
        };
      return {
        status: 409,
        code: 'VERSION_CONFLICT',
        title: 'Conflict',
        detail: 'The request conflicts with the current resource state.',
      };
    }
    return {
      status: 500,
      code: 'INTERNAL_ERROR',
      title: 'Internal server error',
      detail: 'An unexpected server error occurred.',
    };
  }
}
