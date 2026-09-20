export class LibraryError extends Error { constructor(readonly code: string, message: string) { super(message); } }
