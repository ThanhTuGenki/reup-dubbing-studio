import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useQuerySelection(key: string) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selected = searchParams.get(key);
  const setSelected = useCallback((value: string | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  }, [key, setSearchParams]);
  return [selected, setSelected] as const;
}
