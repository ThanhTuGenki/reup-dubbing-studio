import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  createFakeEventSourceFactory,
  FakeEventSource,
} from '../../test/fakes/event-source';
import { useQueryInvalidationStream } from './use-query-invalidation-stream';

describe('query invalidation event stream', () => {
  it('invalidates on events and refetches active REST queries after reconnect', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    const refetch = vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue();
    const source = new FakeEventSource();
    const eventSourceFactory = createFakeEventSourceFactory(source);
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result, unmount } = renderHook(() => useQueryInvalidationStream({
      url: 'http://localhost:3000/v1/events',
      eventName: 'status.changed',
      queryKeys: [['jobs', 'list'], ['workers'], ['jobs', 'list']],
      eventSourceFactory,
    }), { wrapper });

    expect(result.current).toBe('connecting');
    act(() => {
      source.readyState = 1;
      source.emit('open');
    });
    expect(result.current).toBe('open');
    expect(refetch).not.toHaveBeenCalled();

    act(() => {
      source.emit('status.changed', new MessageEvent('status.changed', { data: '{}' }));
    });
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['jobs', 'list'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['workers'] });

    act(() => {
      source.readyState = 0;
      source.emit('error');
      source.readyState = 1;
      source.emit('open');
    });
    expect(result.current).toBe('open');
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(refetch).toHaveBeenCalledWith({ queryKey: ['jobs', 'list'], type: 'active' });
    expect(refetch).toHaveBeenCalledWith({ queryKey: ['workers'], type: 'active' });

    unmount();
    expect(source.close).toHaveBeenCalledOnce();
  });

  it('does not open a connection while disabled', () => {
    const source = new FakeEventSource();
    const eventSourceFactory = createFakeEventSourceFactory(source);
    const queryClient = new QueryClient();
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useQueryInvalidationStream({
      url: '/v1/events',
      queryKeys: [['jobs']],
      enabled: false,
      eventSourceFactory,
    }), { wrapper });

    expect(result.current).toBe('idle');
    expect(eventSourceFactory).not.toHaveBeenCalled();
  });
});
