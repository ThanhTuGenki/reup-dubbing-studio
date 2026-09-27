import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTROL_PLANE_BASE_URL, READY_REQUEST_ID, libraryVideo } from '@/test/fixtures/control-plane';
import { server } from '@/test/msw/server';
import { renderApp } from '@/test/test-utils';
import type { LibraryVideo } from '../api/library-api';
import { DeleteVideoButton } from './delete-video-button';

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('sonner', () => ({ toast }));
const renderAt = (video: LibraryVideo = libraryVideo) => renderApp(<Routes><Route path="/library/:videoId" element={<DeleteVideoButton video={video} />} /><Route path="/library" element={<p>Trang thư viện</p>} /></Routes>, { route: `/library/${video.id}` });

describe('DeleteVideoButton', () => {
  beforeEach(() => { toast.success.mockReset(); toast.error.mockReset(); });

  it('confirms, deletes with the current version and returns to the library', async () => {
    const user = userEvent.setup(); let ifMatch: string | null = null;
    server.use(http.delete(`${CONTROL_PLANE_BASE_URL}/videos/:videoId`, ({ request }) => { ifMatch = request.headers.get('If-Match'); return HttpResponse.json({ data: { videoId: libraryVideo.id, status: 'DELETING', cancelledJobIds: [] }, meta: { requestId: READY_REQUEST_ID } }, { status: 202 }); }));
    renderAt();
    await user.click(screen.getByRole('button', { name: 'Xóa video' }));
    expect(screen.getByRole('alertdialog', { name: 'Xóa video này?' })).toBeInTheDocument();
    expect(screen.getByText('Xóa vĩnh viễn video gốc, audio, video kết quả, SRT và transcript. Không thể khôi phục.')).toBeInTheDocument();
    expect(screen.queryByText('Job đang chạy sẽ bị hủy.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Xóa vĩnh viễn' }));
    expect(await screen.findByText('Trang thư viện')).toBeInTheDocument();
    expect(ifMatch).toBe('"4"');
    expect(toast.success).toHaveBeenCalledWith('Đã xóa video. File sẽ được dọn trong nền.');
  });

  it('warns that the running job will be cancelled', async () => {
    const user = userEvent.setup();
    renderAt({ ...libraryVideo, latestJob: { id: libraryVideo.id, status: 'RUNNING' } });
    await user.click(screen.getByRole('button', { name: 'Xóa video' }));
    expect(screen.getByText('Job đang chạy sẽ bị hủy.')).toBeInTheDocument();
  });

  // Radix's Popper positioning under jsdom settles slowly for the first open; give this one more room than the default 5s.
  it('locks the button for a video with publication proof', { timeout: 30000 }, async () => {
    renderAt({ ...libraryVideo, capabilities: { ...libraryVideo.capabilities, canDelete: false, deleteBlockedReason: 'PUBLICATION_HISTORY' } });
    const button = screen.getByRole('button', { name: 'Xóa video' });
    expect(button).toBeDisabled();
    fireEvent.focus(button.parentElement!);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Video đã có bằng chứng đăng bài nên không thể xóa.');
  });

  it('hides the button while the video is being deleted', () => {
    renderAt({ ...libraryVideo, status: 'DELETING', capabilities: { ...libraryVideo.capabilities, canDelete: false, deleteBlockedReason: 'DELETING' } });
    expect(screen.queryByRole('button', { name: 'Xóa video' })).not.toBeInTheDocument();
  });

  it('shows a Vietnamese message for the refusal code and stays on the page', async () => {
    const user = userEvent.setup();
    server.use(http.delete(`${CONTROL_PLANE_BASE_URL}/videos/:videoId`, () => HttpResponse.json({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'Video has publication history and cannot be deleted', code: 'VIDEO_HAS_PUBLICATION_HISTORY', requestId: READY_REQUEST_ID }, { status: 409, headers: { 'Content-Type': 'application/problem+json' } })));
    renderAt();
    await user.click(screen.getByRole('button', { name: 'Xóa video' }));
    await user.click(screen.getByRole('button', { name: 'Xóa vĩnh viễn' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Video đã có bằng chứng đăng bài nên không thể xóa.'));
    expect(screen.queryByText('Trang thư viện')).not.toBeInTheDocument();
  });
});
