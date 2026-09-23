import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import type { EventStreamState } from '../api/event-stream';

interface UseTransientStreamToastOptions {
  id: string;
  label: string;
  state: EventStreamState | 'idle';
}

export function useTransientStreamToast({ id, label, state }: UseTransientStreamToastOptions) {
  const previousState = useRef<EventStreamState | 'idle'>('idle');

  useEffect(() => {
    const previous = previousState.current;
    previousState.current = state;

    if (state === 'reconnecting') {
      toast.warning(`Mất kết nối cập nhật ${label}.`, {
        id,
        description: 'Ứng dụng đang tự kết nối lại; dữ liệu REST vẫn là nguồn chuẩn.',
        duration: 6_000,
      });
      return;
    }

    if (state === 'closed') {
      toast.error(`Đã dừng cập nhật trực tiếp ${label}.`, {
        id,
        description: 'Làm mới trang để kết nối lại. Dữ liệu hiện tại vẫn được đọc từ API.',
        duration: 8_000,
      });
      return;
    }

    if (state === 'open' && (previous === 'reconnecting' || previous === 'closed')) {
      toast.success(`Đã khôi phục cập nhật ${label}.`, {
        id,
        description: 'Dữ liệu mới nhất đang được đồng bộ lại từ API.',
        duration: 3_000,
      });
    }
  }, [id, label, state]);

  useEffect(() => () => {
    toast.dismiss(id);
  }, [id]);
}
