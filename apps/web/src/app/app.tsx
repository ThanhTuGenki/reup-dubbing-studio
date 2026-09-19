import { BrowserRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { RootErrorBoundary } from './errors/root-error-boundary';
import { QueryProvider } from './providers/query-provider';
import { AppRoutes } from './router/routes';

export function App() {
  return <RootErrorBoundary><QueryProvider><TooltipProvider><BrowserRouter><AppRoutes /><Toaster /></BrowserRouter></TooltipProvider></QueryProvider></RootErrorBoundary>;
}
