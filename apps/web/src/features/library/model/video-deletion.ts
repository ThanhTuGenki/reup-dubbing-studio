import type { LibraryVideo } from '../api/library-api';

export type BulkResult = 'ACCEPTED' | 'ALREADY_DELETING' | 'HAS_PUBLICATION_HISTORY' | 'VERSION_CONFLICT' | 'NOT_FOUND';
const ACTIVE = new Set(['QUEUED', 'RUNNING', 'WAITING_FOR_GPU', 'WAITING_FOR_REVIEW']);

export function hasActiveJob(video: LibraryVideo): boolean { return Boolean(video.latestJob && ACTIVE.has(video.latestJob.status)); }

/** NOT_FOUND means the video is already gone, which is what the operator asked for. */
export function summarizeBulkDeletion(items: Array<{ result: BulkResult }>): { tone: 'success' | 'warning'; message: string } {
  const count = (...results: BulkResult[]) => items.filter((item) => results.includes(item.result)).length;
  const deleted = count('ACCEPTED', 'ALREADY_DELETING', 'NOT_FOUND'); const published = count('HAS_PUBLICATION_HISTORY'); const stale = count('VERSION_CONFLICT');
  const parts = [
    deleted ? `Đã xóa ${deleted} video.${published || stale ? '' : ' File sẽ được dọn trong nền.'}` : null,
    published ? `${published} video có lịch sử đăng bài nên được giữ lại.` : null,
    stale ? `${stale} video vừa thay đổi, tải lại rồi thử lại.` : null,
  ].filter(Boolean);
  return { tone: published || stale ? 'warning' : 'success', message: parts.join(' ') };
}
