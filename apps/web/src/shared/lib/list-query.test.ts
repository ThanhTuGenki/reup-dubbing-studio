import { describe, expect, it } from 'vitest';

import {
  compactListFilters,
  createListQueryKeys,
  hasActiveListFilters,
  normalizeListQuery,
} from './list-query';

describe('list query foundation', () => {
  it('normalizes invalid pagination and removes empty filters', () => {
    expect(normalizeListQuery({
      page: '-2',
      pageSize: 25,
      filters: {
        query: '  kiếm khách  ',
        status: '',
        platforms: ['douyin', '  ', 'bilibili'],
        published: false,
        minimumViews: 0,
      },
    })).toEqual({
      page: 1,
      pageSize: 20,
      filters: {
        query: 'kiếm khách',
        platforms: ['douyin', 'bilibili'],
        published: false,
        minimumViews: 0,
      },
    });
  });

  it('recognizes only meaningful filters', () => {
    expect(hasActiveListFilters({ query: ' ', statuses: [], profile: null })).toBe(false);
    expect(hasActiveListFilters({ query: 'A Lạc' })).toBe(true);
    expect(compactListFilters({ pageOwnedByApi: undefined })).toEqual({});
  });

  it('builds hierarchical keys with a canonical list query', () => {
    const keys = createListQueryKeys('videos');

    expect(keys.all).toEqual(['videos']);
    expect(keys.lists()).toEqual(['videos', 'list']);
    expect(keys.list({ page: '2', pageSize: '50', filters: { query: '  demo ' } })).toEqual([
      'videos',
      'list',
      { page: 2, pageSize: 50, filters: { query: 'demo' } },
    ]);
    expect(keys.detail('video-1')).toEqual(['videos', 'detail', 'video-1']);
  });
});
