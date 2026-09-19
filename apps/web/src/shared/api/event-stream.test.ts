import { describe, expect, it, vi } from 'vitest';

import {
  createFakeEventSourceFactory,
  FakeEventSource,
} from '../../test/fakes/event-source';
import {
  connectEventStream,
  type EventStreamState,
} from './event-stream';

describe('event stream transport', () => {
  it('tracks reconnect without implementing a second retry loop', () => {
    const source = new FakeEventSource();
    const factory = createFakeEventSourceFactory(source);
    const states: EventStreamState[] = [];
    const onReconnect = vi.fn();
    const onMessage = vi.fn();

    const disconnect = connectEventStream({
      url: 'http://localhost:3000/v1/events',
      eventName: 'status.changed',
      eventSourceFactory: factory,
      onMessage,
      onReconnect,
      onStateChange: (state) => states.push(state),
    });

    expect(factory).toHaveBeenCalledWith(
      'http://localhost:3000/v1/events',
      { withCredentials: false },
    );
    source.readyState = 1;
    source.emit('open');
    source.emit('status.changed', new MessageEvent('status.changed', { data: '{"id":"job-1"}' }));
    source.readyState = 0;
    source.emit('error');
    source.readyState = 1;
    source.emit('open');

    expect(states).toEqual(['connecting', 'open', 'reconnecting', 'open']);
    expect(onMessage).toHaveBeenCalledOnce();
    expect(onReconnect).toHaveBeenCalledOnce();

    disconnect();
    expect(source.close).toHaveBeenCalledOnce();
    source.emit('open');
    expect(onReconnect).toHaveBeenCalledOnce();
  });

  it('reports a permanently closed native stream', () => {
    const source = new FakeEventSource();
    const states: EventStreamState[] = [];
    connectEventStream({
      url: '/v1/events',
      eventSourceFactory: createFakeEventSourceFactory(source),
      onMessage: vi.fn(),
      onStateChange: (state) => states.push(state),
    });

    source.readyState = 2;
    source.emit('error');
    expect(states).toEqual(['connecting', 'closed']);
  });
});
