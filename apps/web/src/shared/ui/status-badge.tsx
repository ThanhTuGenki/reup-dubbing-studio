import type { ReactNode } from 'react';
export function StatusBadge({ tone, children }: { tone: 'neutral' | 'positive' | 'negative'; children: ReactNode }) { return <span className={`status-badge status-${tone}`}>{children}</span>; }
