export class PublishingError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
