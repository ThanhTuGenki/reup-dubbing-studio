import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { FeatureUnavailablePage } from '../../routes/feature-unavailable/page';
import { NotFoundPage } from '../../routes/not-found/page';
import { AppShell } from '../layouts/app-shell';
import { paths, reservedPaths } from './paths';

const DashboardPage = lazy(() => import('../../routes/dashboard/page').then((module) => ({ default: module.DashboardPage })));
const DiscoveryPage = lazy(() => import('../../routes/discovery/page').then((module) => ({ default: module.DiscoveryPage })));
const LibraryDetailPage = lazy(() => import('../../routes/library/detail-page').then((module) => ({ default: module.LibraryDetailPage })));
const LibraryPage = lazy(() => import('../../routes/library/page').then((module) => ({ default: module.LibraryPage })));
const ProfilesPage = lazy(() => import('../../routes/profiles/page').then((module) => ({ default: module.ProfilesPage })));
const PublishingPage = lazy(() => import('../../routes/publishing/page').then((module) => ({ default: module.PublishingPage })));
const QueuePage = lazy(() => import('../../routes/queue/page').then((module) => ({ default: module.QueuePage })));
const ReviewPolicyPage = lazy(() => import('../../features/review-policy').then((module) => ({ default: module.ReviewPolicyPage })));
const SettingsPage = lazy(() => import('../../routes/settings/page').then((module) => ({ default: module.SettingsPage })));
const StudioPage = lazy(() => import('../../features/studio').then((module) => ({ default: module.StudioPage })));
const VoicesPage = lazy(() => import('../../routes/voices/page').then((module) => ({ default: module.VoicesPage })));
const WorkersPage = lazy(() => import('../../routes/workers/page').then((module) => ({ default: module.WorkersPage })));

export function AppRoutes() {
  return <Routes><Route element={<AppShell />}><Route path={paths.foundation} element={<DashboardPage />} /><Route path={paths.settings} element={<SettingsPage />} /><Route path={paths.channelProfiles} element={<ProfilesPage />} /><Route path={paths.reviewPolicy} element={<ReviewPolicyPage />} /><Route path={paths.voices} element={<VoicesPage />} /><Route path={paths.discovery} element={<DiscoveryPage />} /><Route path={paths.queue} element={<QueuePage />} /><Route path={paths.workers} element={<WorkersPage />} /><Route path={paths.library} element={<LibraryPage />} /><Route path={paths.libraryVideo} element={<LibraryDetailPage />} /><Route path={paths.studio} element={<StudioPage />} /><Route path={paths.publishing} element={<PublishingPage />} />{reservedPaths.filter((path) => path !== paths.settings && path !== paths.channelProfiles && path !== paths.reviewPolicy && path !== paths.voices && path !== paths.discovery && path !== paths.queue && path !== paths.workers && path !== paths.library && path !== paths.libraryVideo && path !== paths.studio && path !== paths.publishing).map((path) => <Route key={path} path={path} element={<FeatureUnavailablePage />} />)}<Route path="*" element={<NotFoundPage />} /></Route></Routes>;
}
