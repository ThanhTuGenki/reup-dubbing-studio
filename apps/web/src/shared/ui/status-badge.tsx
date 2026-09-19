import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

export function StatusBadge({ tone, children }: { tone: 'neutral' | 'positive' | 'negative'; children: ReactNode }) {
  return <Badge className={`status-badge status-${tone}`} variant="outline">{children}</Badge>;
}
