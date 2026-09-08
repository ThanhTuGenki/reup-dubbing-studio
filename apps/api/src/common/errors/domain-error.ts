import type { components } from '@reup-dubbing-studio/api-contract/web';

export type ErrorCode = components['schemas']['ErrorCode'];

export abstract class DomainError extends Error {
  abstract readonly status: number;

  protected constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
