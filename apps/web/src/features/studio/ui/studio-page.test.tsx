import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';

import { renderApp } from '@/test/test-utils';
import { server } from '@/test/msw/server';
import { CONTROL_PLANE_BASE_URL } from '@/test/fixtures/control-plane';
import { FakeEventSource } from '@/test/fakes/event-source';
import { StudioPage } from './studio-page';

const videoId = '0191f3d2-7f5b-7abc-8b2e-123456789c01';
const segmentId = '0191f3d2-7f5b-7abc-8b2e-123456789c02';
const studioEnvelope = { data: { video: { id: videoId, version: 4, title: 'Tập phim Studio', status: 'AWAITING_REVIEW', sourceDurationMs: 42000 }, transcriptRuns: [], cast: { id: '0191f3d2-7f5b-7abc-8b2e-123456789c03', status: 'APPROVED', version: 1, entries: [{ id: '0191f3d2-7f5b-7abc-8b2e-123456789c04', characterKey: 'narrator', displayName: 'Người kể', roleKind: 'NARRATOR', voice: { id: '0191f3d2-7f5b-7abc-8b2e-123456789c05', name: 'Giọng kể ấm' } }] }, segments: [{ id: segmentId, ordinal: 1, sourceStartMs: 0, sourceEndMs: 2500, revision: { id: '0191f3d2-7f5b-7abc-8b2e-123456789c06', revision: 2, sourceText: '你好', translatedText: 'Xin chào', targetStartMs: 0, targetEndMs: 2500, speechRate: 1, status: 'DRAFT', castSheetEntryId: null, voice: { id: '0191f3d2-7f5b-7abc-8b2e-123456789c05', name: 'Giọng kể ấm' }, preview: { id: '0191f3d2-7f5b-7abc-8b2e-123456789c07', status: 'READY', durationMs: 2300 } } }], reviews: [], capabilities: { canEdit: true, canRegenerate: true, canRender: true } } };

describe('StudioPage', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('edits a segment as a dirty draft and requests preview only on click', async () => {
    const user = userEvent.setup(); const previewSpy = vi.fn(); const saveSpy = vi.fn();
    server.use(
      http.get(`${CONTROL_PLANE_BASE_URL}/videos/:videoId/studio`, () => HttpResponse.json(studioEnvelope)),
      http.post(`${CONTROL_PLANE_BASE_URL}/videos/:videoId/segments/:segmentId/preview`, () => { previewSpy(); return HttpResponse.json({ data: { method: 'GET', url: 'https://media.example/preview.mp3', expiresAt: '2026-09-21T10:05:00.000Z', fileName: 'preview.mp3', contentType: 'audio/mpeg', byteSize: '1200' } }); }),
      http.patch(`${CONTROL_PLANE_BASE_URL}/videos/:videoId/segments/:segmentId`, async ({ request }) => { saveSpy(await request.json(), request.headers.get('If-Match')); return HttpResponse.json({ data: { version: 5, revision: 3 } }); }),
    );
    renderApp(<Routes><Route path="/library/:videoId/studio" element={<StudioPage />} /></Routes>, { route: `/library/${videoId}/studio` });
    expect(await screen.findByRole('heading', { name: 'Tập phim Studio' })).toBeInTheDocument();
    expect(previewSpy).not.toHaveBeenCalled();
    const translation = screen.getByLabelText('Bản dịch segment');
    await user.clear(translation); await user.type(translation, 'Chào bạn');
    expect(screen.getByText('Chưa lưu thay đổi')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lưu revision' }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({ translatedText: 'Chào bạn' }), '"4"'));
    await user.click(screen.getByRole('button', { name: 'Nghe preview' }));
    await waitFor(() => expect(previewSpy).toHaveBeenCalledOnce());
    expect(await screen.findByLabelText('Audio preview')).toHaveAttribute('src', 'https://media.example/preview.mp3');
  });

  it('refreshes Studio REST state after a workflow SSE invalidation', async () => {
    const source = new FakeEventSource(); let requests = 0;
    vi.stubGlobal('EventSource', vi.fn(() => source));
    server.use(http.get(`${CONTROL_PLANE_BASE_URL}/videos/:videoId/studio`, () => { requests += 1; return HttpResponse.json({ ...studioEnvelope, data: { ...studioEnvelope.data, video: { ...studioEnvelope.data.video, version: requests > 1 ? 5 : 4 } } }); }));
    renderApp(<Routes><Route path="/library/:videoId/studio" element={<StudioPage />} /></Routes>, { route: `/library/${videoId}/studio` });
    expect(await screen.findByText('Version 4', { exact: false })).toBeInTheDocument();
    act(() => { source.readyState = 1; source.emit('open'); });
    expect(await screen.findByText('Cập nhật trực tiếp')).toBeInTheDocument();
    act(() => source.emit('queue.invalidate', new MessageEvent('queue.invalidate', { data: JSON.stringify({ videoId }) })));
    await waitFor(() => expect(requests).toBeGreaterThan(1));
    expect(await screen.findByText('Version 5', { exact: false })).toBeInTheDocument();
  });
});
