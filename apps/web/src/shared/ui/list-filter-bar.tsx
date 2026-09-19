import type { PropsWithChildren } from 'react';
import { cn } from 'cn';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface ListFilterBarProps extends PropsWithChildren {
  title: string;
  description?: string;
  isFiltered: boolean;
  onReset: () => void;
  className?: string;
}

export function ListFilterBar({
  title,
  description,
  isFiltered,
  onReset,
  className,
  children,
}: ListFilterBarProps) {
  return (
    <Card role="region" aria-label={title} className={cn('gap-4 py-4 shadow-card', className)}>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        <CardAction>
          <Button type="button" variant="ghost" size="sm" disabled={!isFiltered} onClick={onReset}>
            Đặt lại
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent
        className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:[grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]"
      >
        {children}
      </CardContent>
    </Card>
  );
}
