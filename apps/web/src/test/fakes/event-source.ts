import { vi } from 'vitest';

import type { EventSourceFactory, EventSourceLike } from '../../shared/api/event-stream';

export class FakeEventSource implements EventSourceLike {
  public readyState = 0;
  public readonly close = vi.fn();
  private readonly listeners = new Map<string, Set<EventListener>>();

  public addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  public removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }

  public emit(type: string, event: Event = new Event(type)) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

export function createFakeEventSourceFactory(source: FakeEventSource) {
  return vi.fn<EventSourceFactory>(() => source);
}
