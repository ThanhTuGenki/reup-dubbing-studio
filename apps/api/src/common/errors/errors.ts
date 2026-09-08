import { DomainError, type ErrorCode } from './domain-error';

export class ValidationError extends DomainError {
  readonly status = 400;
  constructor(
    code: ErrorCode = 'VALIDATION_ERROR',
    message = 'One or more request fields failed validation.',
  ) {
    super(code, message);
  }
}

export class UnauthorizedError extends DomainError {
  readonly status = 401;
  constructor(message = 'Authentication is required or invalid.') {
    super('UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends DomainError {
  readonly status = 403;
  constructor(message = 'The caller is not allowed to perform this operation.') {
    super('FORBIDDEN', message);
  }
}

export class NotFoundError extends DomainError {
  readonly status = 404;
  constructor(code: ErrorCode = 'NOT_FOUND', message = 'The requested resource was not found.') {
    super(code, message);
  }
}

export class ConflictError extends DomainError {
  readonly status = 409;
  constructor(
    code: ErrorCode = 'VERSION_CONFLICT',
    message = 'The request conflicts with the current resource state.',
  ) {
    super(code, message);
  }
}

export class UpstreamError extends DomainError {
  readonly status = 503;
  constructor(message = 'A required upstream service is unavailable.') {
    super('UPSTREAM_UNAVAILABLE', message);
  }
}
