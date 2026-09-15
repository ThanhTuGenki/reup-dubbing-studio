import { BrowserRouter } from 'react-router-dom';
import { RootErrorBoundary } from './errors/root-error-boundary';
import { QueryProvider } from './providers/query-provider';
import { AppRoutes } from './router/routes';

export function App() {
  return <RootErrorBoundary><QueryProvider><BrowserRouter><AppRoutes /></BrowserRouter></QueryProvider></RootErrorBoundary>;
}
