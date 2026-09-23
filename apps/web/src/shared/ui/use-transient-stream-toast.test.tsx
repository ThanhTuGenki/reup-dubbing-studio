import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventStreamState } from '../api/event-stream';
import { useTransientStreamToast } from './use-transient-stream-toast';

vi.mock('sonner', () => ({
  toast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

describe('transient stream toast', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stays quiet on initial connect and reports only disconnect and recovery', () => {
    let state: EventStreamState | 'idle' = 'connecting';
    const { rerender, unmount } = renderHook(() => useTransientStreamToast({
      id: 'queue-stream',
      label: 'hàng đợi',
      state,
    }));

    expect(toast.warning).not.toHaveBeenCalled();
    act(() => { state = 'open'; rerender(); });
    expect(toast.success).not.toHaveBeenCalled();

    act(() => { state = 'reconnecting'; rerender(); });
    expect(toast.warning).toHaveBeenCalledWith(
      'Mất kết nối cập nhật hàng đợi.',
      expect.objectContaining({ id: 'queue-stream' }),
    );

    act(() => { state = 'open'; rerender(); });
    expect(toast.success).toHaveBeenCalledWith(
      'Đã khôi phục cập nhật hàng đợi.',
      expect.objectContaining({ id: 'queue-stream' }),
    );

    unmount();
    expect(toast.dismiss).toHaveBeenCalledWith('queue-stream');
  });

  it('reports a permanently closed stream without creating persistent state', () => {
    const { unmount } = renderHook(() => useTransientStreamToast({
      id: 'worker-stream',
      label: 'worker',
      state: 'closed',
    }));

    expect(toast.error).toHaveBeenCalledWith(
      'Đã dừng cập nhật trực tiếp worker.',
      expect.objectContaining({ id: 'worker-stream' }),
    );
    unmount();
  });
});
