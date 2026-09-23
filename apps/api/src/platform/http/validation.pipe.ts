import {
  BadRequestException,
  ValidationPipe,
  type ValidationPipeOptions,
} from '@nestjs/common';

export function createValidationPipe(options: ValidationPipeOptions = {}): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    validationError: { target: false, value: false },
    exceptionFactory: (messages) => new BadRequestException(messages),
    ...options,
  });
}
