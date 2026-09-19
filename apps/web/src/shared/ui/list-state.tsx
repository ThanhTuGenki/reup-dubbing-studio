import type { ReactNode } from 'react';
import { CircleAlertIcon, SearchXIcon } from 'lucide-react';

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';

type ListStateKind = 'loading' | 'empty' | 'error';

interface ListStateProps {
  state: ListStateKind;
  title: string;
  description: string;
  action?: ReactNode;
}

export function ListState({ state, title, description, action }: ListStateProps) {
  return (
    <Empty
      data-state={state}
      role={state === 'error' ? 'alert' : 'status'}
      aria-live={state === 'error' ? 'assertive' : 'polite'}
      className="min-h-56 rounded-xl border bg-muted/30 px-6 py-16"
    >
      <EmptyHeader>
        <EmptyMedia variant={state === 'loading' ? 'default' : 'icon'}>
          {state === 'loading' && (
            <Spinner role="presentation" aria-hidden="true" className="size-[30px] text-primary" />
          )}
          {state === 'empty' && <SearchXIcon aria-hidden="true" />}
          {state === 'error' && <CircleAlertIcon aria-hidden="true" className="text-destructive" />}
        </EmptyMedia>
        <EmptyTitle className="text-base">{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}
