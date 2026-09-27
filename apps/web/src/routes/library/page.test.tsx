import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTROL_PLANE_BASE_URL, READY_REQUEST_ID, libraryVideo } from '@/test/fixtures/control-plane';
import { server } from '@/test/msw/server';
import { renderApp } from '@/test/test-utils';
import { LibraryPage } from './page';

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('sonner', () => ({ toast }));
const meta = { requestId: READY_REQUEST_ID };
const second = { ...libraryVideo, id: '0191f3d2-7f5b-7abc-8b2e-123456789e01', displayTitle: 'Video thứ hai', version: 2, latestJob: { id: '0191f3d2-7f5b-7abc-8b2e-123456789e02', kind: 'FULL_PIPELINE', status: 'RUNNING', progress: 10, currentTask: null, failure: null, updatedAt: libraryVideo.updatedAt } };
const failed = { ...libraryVideo, id: '0191f3d2-7f5b-7abc-8b2e-123456789f01', displayTitle: 'Video xóa lỗi', status: 'DELETE_FAILED', deletion: { requestedAt: libraryVideo.updatedAt, errorCode: 'STORAGE_DELETE_FAILED' } };
const list = (items: unknown[]) => http.get(`${CONTROL_PLANE_BASE_URL}/videos`, () => HttpResponse.json({ data: { items, nextCursor: null }, meta }));

describe('LibraryPage deletion', () => {
  beforeEach(() => { toast.success.mockReset(); toast.warning.mockReset(); toast.error.mockReset(); });

  it('selects videos, warns about running jobs and reports grouped results', async () => {
    const user = userEvent.setup(); let body: unknown = null;
    server.use(list([libraryVideo, second]), http.post(`${CONTROL_PLANE_BASE_URL}/videos/deletions`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ data: { items: [{ videoId: libraryVideo.id, result: 'ACCEPTED', cancelledJobIds: [] }, { videoId: second.id, result: 'HAS_PUBLICATION_HISTORY', cancelledJobIds: [] }] }, meta }); }));
    renderApp(<LibraryPage />, { route: '/library' });
    await user.click(await screen.findByRole('checkbox', { name: 'Chọn tất cả trang này' }));
    expect(screen.getByText('Đã chọn 2 video')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Xóa 2 video' }));
    expect(screen.getByRole('alertdialog', { name: 'Xóa 2 video?' })).toBeInTheDocument();
    expect(screen.getByText('1 video đang có job chạy, job sẽ bị hủy.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Xóa vĩnh viễn' }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('Đã xóa 1 video. 1 video có lịch sử đăng bài nên được giữ lại.'));
    expect(body).toEqual({ items: [{ videoId: libraryVideo.id, version: 4 }, { videoId: second.id, version: 2 }] });
    expect(screen.queryByText('Đã chọn 2 video')).not.toBeInTheDocument();
  });

  it('selects a single row by name', async () => {
    const user = userEvent.setup(); server.use(list([libraryVideo, second]));
    renderApp(<LibraryPage />, { route: '/library' });
    await user.click(await screen.findByRole('checkbox', { name: `Chọn ${second.displayTitle}` }));
    expect(screen.getByRole('button', { name: 'Xóa 1 video' })).toBeInTheDocument();
  });

  it('shows failed deletions with a retry', async () => {
    const user = userEvent.setup(); let ifMatch: string | null = null;
    server.use(list([failed]), http.delete(`${CONTROL_PLANE_BASE_URL}/videos/:videoId`, ({ request }) => { ifMatch = request.headers.get('If-Match'); return HttpResponse.json({ data: { videoId: failed.id, status: 'DELETING', cancelledJobIds: [] }, meta }, { status: 202 }); }));
    renderApp(<LibraryPage />, { route: '/library' });
    expect((await screen.findAllByText('Xóa thất bại')).length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole('button', { name: 'Thử xóa lại' })[0]!);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Đã yêu cầu xóa lại video.'));
    expect(ifMatch).toBe('"4"');
  });
});
