import { describe, expect, it } from 'vitest';
import { navigationGroups, resolveRouteBreadcrumbs, resolveRouteMetadata } from './route-metadata';

describe('route metadata', () => {
  it('covers all nine primary navigation destinations', () => {
    expect(navigationGroups.flatMap(({ items }) => items)).toHaveLength(9);
  });

  it.each([
    ['/', 'Tổng quan'],
    ['/discovery', 'Khám phá video'],
    ['/library/video-1', 'Chi tiết video'],
    ['/library/video-1/studio', 'Studio biên tập'],
    ['/settings', 'Cài đặt'],
    ['/unknown', 'Không tìm thấy trang'],
  ])('resolves %s to %s', (pathname, label) => {
    expect(resolveRouteMetadata(pathname).label).toBe(label);
  });

  it('builds linked hierarchy for nested operational routes', () => {
    expect(resolveRouteBreadcrumbs('/library/video-1/studio')).toEqual([
      { label: 'Thư viện video', path: '/library' },
      { label: 'Chi tiết video', path: '/library/video-1' },
      { label: 'Studio biên tập' },
    ]);
    expect(resolveRouteBreadcrumbs('/channel-profiles/channel/profile-1/review-policy')).toEqual([
      { label: 'Hồ sơ', path: '/channel-profiles' },
      { label: 'Tự động hóa & điểm duyệt' },
    ]);
  });
});
