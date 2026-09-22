import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { paths } from '@/app/router/paths';
import { CONTROL_PLANE_BASE_URL, READY_REQUEST_ID, channelReviewPolicy, seriesProfile } from '@/test/fixtures/control-plane';
import { server } from '@/test/msw/server';
import { renderApp } from '@/test/test-utils';
import { ReviewPolicyPage } from './review-policy-page';

function renderPolicy(route: string) {
  return renderApp(<Routes><Route path={paths.reviewPolicy} element={<ReviewPolicyPage />} /></Routes>, { route });
}

describe('ReviewPolicyPage', () => {
  it('loads effective gates and saves only changed fields with generated contract headers', async () => {
    const user = userEvent.setup();
    const capture = vi.fn();
    server.use(http.patch(`${CONTROL_PLANE_BASE_URL}/channel-profiles/:id/review-policy`, async ({ request }) => {
      capture({ body: await request.json(), match: request.headers.get('If-Match'), key: request.headers.get('Idempotency-Key') });
      return HttpResponse.json({ data: { ...channelReviewPolicy, stored: { ...channelReviewPolicy.stored, ttsGate: 'NOT_REQUIRED' }, effective: { ...channelReviewPolicy.effective, ttsGate: 'NOT_REQUIRED' }, version: 3 }, meta: { requestId: READY_REQUEST_ID } }, { headers: { ETag: '"3"' } });
    }));
    renderPolicy(`/channel-profiles/channel/${channelReviewPolicy.ownerProfileId}/review-policy`);
    expect(await screen.findByRole('heading', { name: 'Tự động hóa & điểm duyệt' })).toBeInTheDocument();
    expect(await screen.findByText('Kênh Việt hóa')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Điểm duyệt Audio TTS'));
    await user.click(screen.getByRole('option', { name: 'Không cần duyệt' }));
    expect(screen.getByText('Có thay đổi chưa áp dụng')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Áp dụng chính sách' }));
    await waitFor(() => expect(capture).toHaveBeenCalledTimes(1));
    expect(capture.mock.calls[0]?.[0]).toMatchObject({ body: { ttsGate: 'NOT_REQUIRED' }, match: '"2"' });
    expect(capture.mock.calls[0]?.[0].key).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('resets a Series field to Channel inheritance and explains the immutable snapshot', async () => {
    const user = userEvent.setup();
    let body: unknown;
    server.use(http.patch(`${CONTROL_PLANE_BASE_URL}/series-profiles/:id/review-policy`, async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ data: { ...channelReviewPolicy, ownerType: 'SERIES', ownerProfileId: seriesProfile.id, stored: { ...channelReviewPolicy.stored, scriptGate: null }, version: 4, parentPolicyVersion: 2 }, meta: { requestId: READY_REQUEST_ID } }, { headers: { ETag: '"4:2"' } });
    }));
    renderPolicy(`/channel-profiles/series/${seriesProfile.id}/review-policy`);
    expect(await screen.findByText('Series kế thừa theo từng trường')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Điểm duyệt Kịch bản dịch'));
    await user.click(screen.getByRole('option', { name: 'Kế thừa từ Channel' }));
    await user.click(screen.getByRole('button', { name: 'Áp dụng chính sách' }));
    await waitFor(() => expect(body).toEqual({ scriptGate: null }));
    expect(screen.getByText('Job đang chạy giữ nguyên policy snapshot đã chụp lúc tạo.')).toBeInTheDocument();
  });

  it('preserves the draft after a parent-version conflict', async () => {
    const user = userEvent.setup();
    server.use(http.patch(`${CONTROL_PLANE_BASE_URL}/series-profiles/:id/review-policy`, () => HttpResponse.json({ type: 'about:blank', title: 'Conflict', status: 412, code: 'VERSION_CONFLICT', detail: 'Review policy version is stale', requestId: READY_REQUEST_ID }, { status: 412 })));
    renderPolicy(`/channel-profiles/series/${seriesProfile.id}/review-policy`);
    await user.click(await screen.findByLabelText('Điểm duyệt Cast & giọng'));
    await user.click(screen.getByRole('option', { name: 'Cần duyệt thủ công' }));
    await user.click(screen.getByRole('button', { name: 'Áp dụng chính sách' }));
    await waitFor(() => expect(screen.getByText('Có thay đổi chưa áp dụng')).toBeInTheDocument());
    expect(screen.getByLabelText('Điểm duyệt Cast & giọng')).toHaveTextContent('Cần duyệt thủ công');
  });
});
