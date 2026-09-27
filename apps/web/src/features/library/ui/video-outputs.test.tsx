import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '@/test/test-utils';
import { CONTROL_PLANE_BASE_URL, READY_REQUEST_ID, libraryOutputId, libraryVideo } from '@/test/fixtures/control-plane';
import { server } from '@/test/msw/server';
import { VideoOutputs } from './video-outputs';

const grantUrl = `${CONTROL_PLANE_BASE_URL}/videos/${libraryVideo.id}/outputs/${libraryOutputId}/:part/grant`;
const meta = { requestId: READY_REQUEST_ID };

function captureGrants() {
  const calls: { part: string; purpose: unknown }[] = [];
  server.use(http.post(grantUrl, async ({ params, request }) => {
    const body = await request.json() as { purpose?: unknown };
    calls.push({ part: String(params.part), purpose: body.purpose });
    return HttpResponse.json({ data: { method: 'GET', url: `https://r2.example.test/${String(params.part)}-${String(body.purpose)}`, expiresAt: '2026-09-27T10:00:00.000Z', fileName: `file.${String(params.part)}`, contentType: null }, meta });
  }));
  return calls;
}

describe('VideoOutputs', () => {
  it('lists the dubbed video and its SRT for each ready output', () => {
    renderApp(<VideoOutputs video={libraryVideo} />);
    expect(screen.getByRole('heading', { name: 'Kết quả xử lý' })).toBeInTheDocument();
    expect(screen.getByText('Video đã lồng tiếng 16:9')).toBeInTheDocument();
    expect(screen.getByText('video-vi-16x9.mp4')).toBeInTheDocument();
    expect(screen.getByText('File SRT 16:9')).toBeInTheDocument();
    expect(screen.getByText('video-vi-16x9.srt')).toBeInTheDocument();
  });

  it('requests a preview grant only when asked and plays it inline', async () => {
    const user = userEvent.setup(); const calls = captureGrants();
    renderApp(<VideoOutputs video={libraryVideo} />);
    expect(calls).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Xem trước video 16:9' }));
    const player = await screen.findByLabelText('Video đã lồng tiếng 16:9');
    expect(player.tagName).toBe('VIDEO');
    expect(player).toHaveAttribute('src', 'https://r2.example.test/video-preview');
    expect(player).toHaveAttribute('controls');
    expect(calls).toEqual([{ part: 'video', purpose: 'preview' }]);
  });

  it('downloads MP4 and SRT through fresh download grants', async () => {
    const user = userEvent.setup(); const calls = captureGrants(); const onDownload = vi.fn();
    renderApp(<VideoOutputs video={libraryVideo} onDownload={onDownload} />);
    await user.click(screen.getByRole('button', { name: 'Tải MP4 16:9' }));
    await user.click(screen.getByRole('button', { name: 'Tải SRT 16:9' }));
    await vi.waitFor(() => expect(onDownload).toHaveBeenCalledTimes(2));
    expect(onDownload).toHaveBeenNthCalledWith(1, 'https://r2.example.test/video-download');
    expect(onDownload).toHaveBeenNthCalledWith(2, 'https://r2.example.test/subtitle-download');
    expect(calls).toEqual([{ part: 'video', purpose: 'download' }, { part: 'subtitle', purpose: 'download' }]);
  });

  it('explains a failed grant without leaving the button stuck', async () => {
    const user = userEvent.setup();
    server.use(http.post(grantUrl, () => HttpResponse.json({ type: 'about:blank', title: 'Unavailable', status: 503, code: 'STORAGE_UNAVAILABLE', detail: 'R2 không phản hồi.', requestId: READY_REQUEST_ID }, { status: 503 })));
    renderApp(<VideoOutputs video={libraryVideo} onDownload={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Tải MP4 16:9' });
    await user.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('R2 không phản hồi.');
    expect(button).toBeEnabled();
  });

  it('hides the SRT row when the output has no subtitle', () => {
    const withoutSrt = { ...libraryVideo, outputs: libraryVideo.outputs.map((item) => ({ ...item, subtitle: null })) };
    renderApp(<VideoOutputs video={withoutSrt} />);
    expect(screen.queryByText('File SRT 16:9')).not.toBeInTheDocument();
    expect(screen.getByText('Video đã lồng tiếng 16:9')).toBeInTheDocument();
  });

  it('shows an empty state until an output is ready', () => {
    const pending = { ...libraryVideo, outputs: libraryVideo.outputs.map((item) => ({ ...item, status: 'RENDERING' })) };
    renderApp(<VideoOutputs video={pending} />);
    expect(screen.getByText('Chưa có video kết quả. Video sẽ hiện ở đây khi pipeline render xong.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tải MP4/u })).not.toBeInTheDocument();
  });
});
