export class StudioError extends Error { constructor(readonly code: string, message: string) { super(message); } }
