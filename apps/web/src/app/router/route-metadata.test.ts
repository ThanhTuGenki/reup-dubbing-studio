import { describe, expect, it } from 'vitest';
import { navigationGroups, resolveRouteMetadata } from './route-metadata';

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
});
