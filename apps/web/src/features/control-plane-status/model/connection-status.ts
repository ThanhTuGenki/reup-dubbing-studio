export type ConnectionStatus =
  | { state: 'loading' }
  | { state: 'ready'; requestId: string }
  | { state: 'error'; message: string; requestId?: string };
