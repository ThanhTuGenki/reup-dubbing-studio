import { describe, expect, it } from 'vitest';
import { libraryVideo } from '@/test/fixtures/control-plane';
import { hasActiveJob, summarizeBulkDeletion } from './video-deletion';

const item = (result: 'ACCEPTED' | 'ALREADY_DELETING' | 'HAS_PUBLICATION_HISTORY' | 'VERSION_CONFLICT' | 'NOT_FOUND') => ({ videoId: libraryVideo.id, result, cancelledJobIds: [] });

describe('video deletion model', () => {
  it('groups bulk results into one readable message', () => {
    expect(summarizeBulkDeletion([item('ACCEPTED'), item('ACCEPTED'), item('ALREADY_DELETING')])).toEqual({ tone: 'success', message: 'Đã xóa 3 video. File sẽ được dọn trong nền.' });
    expect(summarizeBulkDeletion([item('ACCEPTED'), item('NOT_FOUND'), item('HAS_PUBLICATION_HISTORY'), item('VERSION_CONFLICT')])).toEqual({ tone: 'warning', message: 'Đã xóa 2 video. 1 video có lịch sử đăng bài nên được giữ lại. 1 video vừa thay đổi, tải lại rồi thử lại.' });
    expect(summarizeBulkDeletion([item('HAS_PUBLICATION_HISTORY')])).toEqual({ tone: 'warning', message: '1 video có lịch sử đăng bài nên được giữ lại.' });
  });

  it('detects a job that deletion would cancel', () => {
    expect(hasActiveJob({ ...libraryVideo, latestJob: null })).toBe(false);
    expect(hasActiveJob({ ...libraryVideo, latestJob: { id: libraryVideo.id, status: 'WAITING_FOR_GPU' } })).toBe(true);
    expect(hasActiveJob({ ...libraryVideo, latestJob: { id: libraryVideo.id, status: 'SUCCEEDED' } })).toBe(false);
  });
});
