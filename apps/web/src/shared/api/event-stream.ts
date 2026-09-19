export type EventStreamState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface EventSourceLike {
  readonly readyState: number;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  close(): void;
}

export type EventSourceFactory = (
  url: string | URL,
  init?: EventSourceInit,
) => EventSourceLike;

interface ConnectEventStreamOptions {
  url: string | URL;
  eventName?: string;
  withCredentials?: boolean;
  onMessage: (event: MessageEvent<string>) => void;
  onReconnect?: () => void;
  onStateChange?: (state: EventStreamState) => void;
  eventSourceFactory?: EventSourceFactory;
}

const EVENT_SOURCE_CLOSED = 2;

const createBrowserEventSource: EventSourceFactory = (url, init) => new EventSource(url, init);

export function connectEventStream({
  url,
  eventName = 'message',
  withCredentials = false,
  onMessage,
  onReconnect,
  onStateChange,
  eventSourceFactory = createBrowserEventSource,
}: ConnectEventStreamOptions): () => void {
  const source = eventSourceFactory(url, { withCredentials });
  let hasOpened = false;
  let disconnected = false;

  const changeState = (state: EventStreamState) => {
    if (!disconnected) onStateChange?.(state);
  };

  const handleOpen: EventListener = () => {
    const reconnected = hasOpened;
    hasOpened = true;
    changeState('open');
    if (reconnected) onReconnect?.();
  };

  const handleError: EventListener = () => {
    changeState(source.readyState === EVENT_SOURCE_CLOSED ? 'closed' : 'reconnecting');
  };

  const handleMessage: EventListener = (event) => {
    onMessage(event as MessageEvent<string>);
  };

  onStateChange?.('connecting');
  source.addEventListener('open', handleOpen);
  source.addEventListener('error', handleError);
  source.addEventListener(eventName, handleMessage);

  return () => {
    disconnected = true;
    source.removeEventListener('open', handleOpen);
    source.removeEventListener('error', handleError);
    source.removeEventListener(eventName, handleMessage);
    source.close();
  };
}
