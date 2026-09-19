import { BrowserRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RootErrorBoundary } from './errors/root-error-boundary';
import { QueryProvider } from './providers/query-provider';
import { AppRoutes } from './router/routes';

export function App() {
  return <RootErrorBoundary><QueryProvider><TooltipProvider><BrowserRouter><AppRoutes /></BrowserRouter></TooltipProvider></QueryProvider></RootErrorBoundary>;
}
