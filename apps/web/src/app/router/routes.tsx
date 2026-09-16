import { Route, Routes } from 'react-router-dom';
import { FeatureUnavailablePage } from '../../routes/feature-unavailable/page';
import { FoundationPage } from '../../routes/foundation/page';
import { NotFoundPage } from '../../routes/not-found/page';
import { AppShell } from '../layouts/app-shell';
import { paths, reservedPaths } from './paths';

export function AppRoutes() {
  return <Routes><Route element={<AppShell />}><Route path={paths.foundation} element={<FoundationPage />} />{reservedPaths.map((path) => <Route key={path} path={path} element={<FeatureUnavailablePage />} />)}<Route path="*" element={<NotFoundPage />} /></Route></Routes>;
}
