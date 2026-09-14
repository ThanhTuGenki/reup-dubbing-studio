import {
  Catch,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';

type HttpRequest = {
  requestId?: string;
  id?: string;
  method?: string;
  url?: string;
};

type HttpResponse = {
  status: (status: number) => HttpResponse;
  type: (contentType: string) => HttpResponse;
  header: (name: string, value: string) => HttpResponse;
  send: (body: unknown) => HttpResponse;
};

type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  instance?: string;
  code: string;
  requestId: string;
  detail?: string;
};

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<HttpRequest>();
    const response = context.getResponse<HttpResponse>();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const problem = this.toProblemDetails(exception, status, request);

    response
      .status(status)
      .type('application/problem+json')
      .header('X-Request-Id', problem.requestId)
      .send(problem);
  }

  private toProblemDetails(
    exception: unknown,
    status: number,
    request: HttpRequest,
  ): ProblemDetails {
    const requestId = request.requestId ?? request.id ?? '';
    const isKnownHttpError = exception instanceof HttpException;
    const code = codeForStatus(status);
    const problem: ProblemDetails = {
      type: `https://httpstatuses.com/${status}`,
      title: titleForStatus(status),
      status,
      code,
      requestId,
    };
    if (request.url) problem.instance = request.url;

    // Only expose framework-generated client errors. Never serialize unknown errors.
    if (isKnownHttpError && status < 500) {
      const response = exception.getResponse();
      const detail = typeof response === 'string'
        ? response
        : typeof response === 'object' && response !== null && 'message' in response
          ? messageText((response as { message?: unknown }).message)
          : undefined;
      if (detail) problem.detail = detail;
    }

    return problem;
  }
}

function codeForStatus(status: number): string {
  if (status === HttpStatus.BAD_REQUEST) return 'VALIDATION_ERROR';
  if (status === HttpStatus.NOT_FOUND) return 'ROUTE_NOT_FOUND';
  if (status === HttpStatus.TOO_MANY_REQUESTS) return 'RATE_LIMITED';
  return status >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR';
}

function titleForStatus(status: number): string {
  if (status === HttpStatus.BAD_REQUEST) return 'Bad Request';
  if (status === HttpStatus.NOT_FOUND) return 'Not Found';
  if (status === HttpStatus.TOO_MANY_REQUESTS) return 'Too Many Requests';
  return status >= 500 ? 'Internal Server Error' : 'HTTP Error';
}

function messageText(message: unknown): string | undefined {
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && message.every((item) => typeof item === 'string')) {
    return message.join(', ');
  }
  return undefined;
}
