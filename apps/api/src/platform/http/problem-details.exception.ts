import { HttpException } from '@nestjs/common';

export class ProblemDetailsException extends HttpException {
  constructor(
    status: number,
    readonly problemCode: string,
    readonly safeDetail: string,
  ) {
    super({ message: safeDetail }, status);
  }
}
