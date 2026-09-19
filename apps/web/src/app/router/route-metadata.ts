import { matchPath } from 'react-router-dom';
import { paths } from './paths';

export type RouteMetadata = {
  path: string
  label: string
  end?: boolean
};

export const navigationGroups: ReadonlyArray<{
  label: string
  items: ReadonlyArray<RouteMetadata>
}> = [
  {
    label: 'Không gian làm việc',
    items: [
      { path: paths.foundation, label: 'Tổng quan', end: true },
      { path: paths.discovery, label: 'Khám phá video' },
      { path: paths.queue, label: 'Hàng đợi xử lý' },
      { path: paths.library, label: 'Thư viện video' },
      { path: paths.publishing, label: 'Bàn đăng bài' },
    ],
  },
  {
    label: 'Cấu hình nội dung',
    items: [
      { path: paths.channelProfiles, label: 'Hồ sơ' },
      { path: paths.voices, label: 'Thư viện giọng' },
    ],
  },
  {
    label: 'Hệ thống',
    items: [
      { path: paths.workers, label: 'GPU Workers' },
      { path: paths.settings, label: 'Cài đặt' },
    ],
  },
];

const detailRoutes: ReadonlyArray<RouteMetadata> = [
  { path: paths.libraryVideo, label: 'Chi tiết video', end: true },
];

const notFoundMetadata: RouteMetadata = {
  path: '*',
  label: 'Không tìm thấy trang',
};

export function resolveRouteMetadata(pathname: string): RouteMetadata {
  const routes = [...detailRoutes, ...navigationGroups.flatMap(({ items }) => items)];
  return routes.find(({ path, end }) => matchPath({ path, end: end ?? true }, pathname)) ?? notFoundMetadata;
}
