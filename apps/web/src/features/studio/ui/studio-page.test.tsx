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

  it('keeps the draft and retries against the refreshed version after a conflict', async () => {
    const user = userEvent.setup(); let reads = 0; const matches: Array<string | null> = [];
    server.use(
      http.get(`${CONTROL_PLANE_BASE_URL}/videos/:videoId/studio`, () => { reads += 1; return HttpResponse.json({ ...studioEnvelope, data: { ...studioEnvelope.data, video: { ...studioEnvelope.data.video, version: reads > 1 ? 5 : 4 } } }); }),
      http.patch(`${CONTROL_PLANE_BASE_URL}/videos/:videoId/segments/:segmentId`, ({ request }) => { matches.push(request.headers.get('If-Match')); if (matches.length === 1) return HttpResponse.json({ type: 'about:blank', title: 'Conflict', status: 412, code: 'VERSION_CONFLICT', detail: 'Studio version is stale' }, { status: 412 }); return HttpResponse.json({ data: { version: 6, revision: 3 } }); }),
    );
    renderStudio();
    const translation = await screen.findByLabelText('Bản dịch segment'); await user.clear(translation); await user.type(translation, 'Giữ bản nháp này');
    await user.click(screen.getByRole('button', { name: 'Lưu revision' }));
    expect(await screen.findByText(/bản nháp của bạn vẫn được giữ/u)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Version 5', { exact: false })).toBeInTheDocument());
    expect(translation).toHaveValue('Giữ bản nháp này');
    await user.click(screen.getByRole('button', { name: 'Thử lưu lại' }));
    await waitFor(() => expect(matches).toEqual(['"4"', '"5"']));
  });

  it('reuses the regenerate idempotency key when retrying a transient failure', async () => {
    const user = userEvent.setup(); const keys: Array<string | null> = [];
    server.use(
      http.get(`${CONTROL_PLANE_BASE_URL}/videos/:videoId/studio`, () => HttpResponse.json(studioEnvelope)),
      http.post(`${CONTROL_PLANE_BASE_URL}/videos/:videoId/segments/:segmentId/regenerate`, ({ request }) => { keys.push(request.headers.get('Idempotency-Key')); if (keys.length === 1) return HttpResponse.json({ type: 'about:blank', title: 'Unavailable', status: 503, code: 'INTERNAL_ERROR', detail: 'Tạm thời chưa thể tạo audio' }, { status: 503 }); return HttpResponse.json({ data: { version: 5, jobId: videoId, taskId: segmentId } }, { status: 202 }); }),
    );
    renderStudio();
    await user.click(await screen.findByRole('button', { name: 'Re-generate' }));
    await user.click(await screen.findByRole('button', { name: 'Thử re-generate lại' }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).toBe(keys[1]);
  });

  it('warns before leaving with an unsaved accessible editor draft', async () => {
    const user = userEvent.setup(); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    server.use(http.get(`${CONTROL_PLANE_BASE_URL}/videos/:videoId/studio`, () => HttpResponse.json(studioEnvelope)));
    renderStudio();
    expect(await screen.findByRole('navigation', { name: 'Danh sách segment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /01.*Xin chào.*DRAFT/u })).toHaveAttribute('aria-current', 'true');
    await user.type(screen.getByLabelText('Bản dịch segment'), ' chưa lưu');
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    await user.click(screen.getByRole('link', { name: 'Chi tiết video' }));
    expect(confirm).toHaveBeenCalledOnce(); expect(screen.getByRole('heading', { name: 'Tập phim Studio' })).toBeInTheDocument();
    expect(screen.getByLabelText('Quyết định review')).toBeInTheDocument(); expect(screen.getByLabelText('Ghi chú review')).toBeInTheDocument();
  });
});

function renderStudio() { return renderApp(<Routes><Route path="/library/:videoId/studio" element={<StudioPage />} /></Routes>, { route: `/library/${videoId}/studio` }); }
