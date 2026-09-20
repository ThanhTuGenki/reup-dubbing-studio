import { Route, Routes } from 'react-router-dom';
import { FeatureUnavailablePage } from '../../routes/feature-unavailable/page';
import { FoundationPage } from '../../routes/foundation/page';
import { NotFoundPage } from '../../routes/not-found/page';
import { ProfilesPage } from '../../routes/profiles/page';
import { SettingsPage } from '../../routes/settings/page';
import { VoicesPage } from '../../routes/voices/page';
import { DiscoveryPage } from '../../routes/discovery/page';
import { QueuePage } from '../../routes/queue/page';
import { WorkersPage } from '../../routes/workers/page';
import { LibraryPage } from '../../routes/library/page';
import { LibraryDetailPage } from '../../routes/library/detail-page';
import { AppShell } from '../layouts/app-shell';
import { paths, reservedPaths } from './paths';

export function AppRoutes() {
  return <Routes><Route element={<AppShell />}><Route path={paths.foundation} element={<FoundationPage />} /><Route path={paths.settings} element={<SettingsPage />} /><Route path={paths.channelProfiles} element={<ProfilesPage />} /><Route path={paths.voices} element={<VoicesPage />} /><Route path={paths.discovery} element={<DiscoveryPage />} /><Route path={paths.queue} element={<QueuePage />} /><Route path={paths.workers} element={<WorkersPage />} /><Route path={paths.library} element={<LibraryPage />} /><Route path={paths.libraryVideo} element={<LibraryDetailPage />} />{reservedPaths.filter((path) => path !== paths.settings && path !== paths.channelProfiles && path !== paths.voices && path !== paths.discovery && path !== paths.queue && path !== paths.workers && path !== paths.library && path !== paths.libraryVideo).map((path) => <Route key={path} path={path} element={<FeatureUnavailablePage />} />)}<Route path="*" element={<NotFoundPage />} /></Route></Routes>;
}
