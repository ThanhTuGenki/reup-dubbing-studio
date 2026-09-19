import {
  hashKey,
  type QueryKey,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import {
  connectEventStream,
  type EventSourceFactory,
  type EventStreamState,
} from './event-stream';

interface UseQueryInvalidationStreamOptions {
  url: string;
  queryKeys: readonly QueryKey[];
  enabled?: boolean;
  eventName?: string;
  withCredentials?: boolean;
  eventSourceFactory?: EventSourceFactory;
}

function uniqueQueryKeys(queryKeys: readonly QueryKey[]): QueryKey[] {
  return [...new Map(queryKeys.map((queryKey) => [hashKey(queryKey), queryKey])).values()];
}

export function useQueryInvalidationStream({
  url,
  queryKeys,
  enabled = true,
  eventName = 'message',
  withCredentials = false,
  eventSourceFactory,
}: UseQueryInvalidationStreamOptions): EventStreamState | 'idle' {
  const queryClient = useQueryClient();
  const queryKeysRef = useRef(queryKeys);
  const [state, setState] = useState<EventStreamState | 'idle'>(enabled ? 'connecting' : 'idle');
  const queryKeySignature = queryKeys.map(hashKey).sort().join('|');
  queryKeysRef.current = queryKeys;

  useEffect(() => {
    if (!enabled) {
      setState('idle');
      return;
    }

    const targets = uniqueQueryKeys(queryKeysRef.current);
    return connectEventStream({
      url,
      eventName,
      withCredentials,
      ...(eventSourceFactory ? { eventSourceFactory } : {}),
      onStateChange: setState,
      onMessage: () => {
        targets.forEach((queryKey) => {
          void queryClient.invalidateQueries({ queryKey });
        });
      },
      onReconnect: () => {
        targets.forEach((queryKey) => {
          void queryClient.refetchQueries({ queryKey, type: 'active' });
        });
      },
    });
  }, [enabled, eventName, eventSourceFactory, queryClient, queryKeySignature, url, withCredentials]);

  return state;
}
