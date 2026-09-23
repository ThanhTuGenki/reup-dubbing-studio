import { matchPath } from 'react-router-dom';
import { paths } from './paths';

export type RouteMetadata = {
  path: string
  label: string
  keywords: readonly string[]
  end?: boolean
};

export const navigationGroups: ReadonlyArray<{
  label: string
  items: ReadonlyArray<RouteMetadata>
}> = [
  {
    label: 'Không gian làm việc',
    items: [
      { path: paths.foundation, label: 'Tổng quan', keywords: ['dashboard', 'kpi'], end: true },
      { path: paths.discovery, label: 'Khám phá video', keywords: ['douyin', 'nguồn', 'discovery'] },
      { path: paths.queue, label: 'Hàng đợi xử lý', keywords: ['queue', 'job', 'task'] },
      { path: paths.library, label: 'Thư viện video', keywords: ['library', 'video', 'output'] },
      { path: paths.publishing, label: 'Bàn đăng bài', keywords: ['publishing', 'youtube', 'facebook'] },
    ],
  },
  {
    label: 'Cấu hình nội dung',
    items: [
      { path: paths.channelProfiles, label: 'Hồ sơ', keywords: ['channel', 'series', 'profile'] },
      { path: paths.voices, label: 'Thư viện giọng', keywords: ['voice', 'tts', 'sample'] },
    ],
  },
  {
    label: 'Hệ thống',
    items: [
      { path: paths.workers, label: 'GPU Workers', keywords: ['gpu', 'worker', 'rental', 'chi phí'] },
      { path: paths.settings, label: 'Cài đặt', keywords: ['settings', 'storage', 'credential'] },
    ],
  },
];

const detailRoutes: ReadonlyArray<RouteMetadata> = [
  { path: paths.reviewPolicy, label: 'Tự động hóa & điểm duyệt', keywords: ['review', 'policy'], end: true },
  { path: paths.studio, label: 'Studio biên tập', keywords: ['studio', 'transcript'], end: true },
  { path: paths.libraryVideo, label: 'Chi tiết video', keywords: ['video', 'detail'], end: true },
];

const notFoundMetadata: RouteMetadata = {
  path: '*',
  label: 'Không tìm thấy trang',
  keywords: [],
};

export function resolveRouteMetadata(pathname: string): RouteMetadata {
  const routes = [...detailRoutes, ...navigationGroups.flatMap(({ items }) => items)];
  return routes.find(({ path, end }) => matchPath({ path, end: end ?? true }, pathname)) ?? notFoundMetadata;
}

export type RouteBreadcrumb = { label: string; path?: string };

export function resolveRouteBreadcrumbs(pathname: string): RouteBreadcrumb[] {
  const metadata = resolveRouteMetadata(pathname);
  const studio = matchPath(paths.studio, pathname);
  if (studio) return [
    { label: 'Thư viện video', path: paths.library },
    { label: 'Chi tiết video', path: `/library/${studio.params.videoId}` },
    { label: metadata.label },
  ];
  if (matchPath(paths.libraryVideo, pathname)) return [{ label: 'Thư viện video', path: paths.library }, { label: metadata.label }];
  if (matchPath(paths.reviewPolicy, pathname)) return [{ label: 'Hồ sơ', path: paths.channelProfiles }, { label: metadata.label }];
  return [{ label: metadata.label }];
}
