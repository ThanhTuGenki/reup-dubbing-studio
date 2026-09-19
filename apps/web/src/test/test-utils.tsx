import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';

export function renderApp(ui: ReactElement, options?: RenderOptions & { route?: string }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <MemoryRouter initialEntries={[options?.route ?? '/']}>
      <QueryClientProvider client={queryClient}><TooltipProvider>{ui}</TooltipProvider></QueryClientProvider>
    </MemoryRouter>,
    options,
  );
}
