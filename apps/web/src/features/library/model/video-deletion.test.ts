import { describe, expect, it } from 'vitest';
import { libraryVideo } from '@/test/fixtures/control-plane';
import { LibraryApiError } from '../api/library-api';
import { deletionErrorMessage, hasActiveJob, summarizeBulkDeletion } from './video-deletion';

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

  it('maps known deletion error codes to Vietnamese and keeps the fallback otherwise', () => {
    const error = (code?: string) => new LibraryApiError('English detail from the API', code);
    expect(deletionErrorMessage(error('VIDEO_VERSION_CONFLICT'), 'Không thể xóa video.')).toBe('Video vừa thay đổi. Tải lại rồi thử lại.');
    expect(deletionErrorMessage(error('VIDEO_HAS_PUBLICATION_HISTORY'), 'Không thể xóa video.')).toBe('Video đã có bằng chứng đăng bài nên không thể xóa.');
    expect(deletionErrorMessage(error('VIDEO_NOT_FOUND'), 'Không thể xóa video.')).toBe('Video không còn tồn tại.');
    expect(deletionErrorMessage(error('IDEMPOTENCY_KEY_REUSED'), 'Không thể xóa video.')).toBe('Yêu cầu xóa bị trùng. Tải lại rồi thử lại.');
    expect(deletionErrorMessage(new LibraryApiError('Control Plane trả về dữ liệu không hợp lệ.'), 'Không thể xóa video.')).toBe('Control Plane trả về dữ liệu không hợp lệ.');
    expect(deletionErrorMessage(new Error('network'), 'Không thể xóa các video đã chọn.')).toBe('Không thể xóa các video đã chọn.');
  });
});
