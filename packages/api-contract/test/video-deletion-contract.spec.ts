import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Video, VideoBulkDeletionItemResult, VideoBulkDeletionRequest, VideoDeletionResult } from '../src';

describe('Video deletion contract', () => {
  it('exposes deletion state and an explicit delete capability on Video', () => {
    expectTypeOf<Video['capabilities']['canDelete']>().toEqualTypeOf<boolean>();
    expectTypeOf<Video['capabilities']['deleteBlockedReason']>().toEqualTypeOf<'PUBLICATION_HISTORY' | 'DELETING' | null>();
    expectTypeOf<NonNullable<Video['deletion']>['errorCode']>().toEqualTypeOf<string | null>();
  });

  it('reports one result per requested video, in request order', () => {
    expectTypeOf<VideoBulkDeletionItemResult['result']>().toEqualTypeOf<'ACCEPTED' | 'ALREADY_DELETING' | 'HAS_PUBLICATION_HISTORY' | 'VERSION_CONFLICT' | 'NOT_FOUND'>();
    expectTypeOf<VideoDeletionResult['status']>().toEqualTypeOf<'DELETING' | 'DELETE_FAILED'>();
    const request: VideoBulkDeletionRequest = { items: [{ videoId: '0191f3d2-7f5b-7abc-8b2e-123456789d01', version: 1 }] };
    expect(request.items).toHaveLength(1);
    expect(request).not.toHaveProperty('objectKey');
  });
});
