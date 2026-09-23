import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CONTROL_PLANE_BASE_URL, publicationDetailEnvelope, publicationTask, READY_REQUEST_ID } from '@/test/fixtures/control-plane';
import { server } from '@/test/msw/server';
import { renderApp } from '@/test/test-utils';
import { PublishingPage } from './publishing-page';

describe('PublishingPage', () => {
  it('opens an API-owned Dashboard task deep link directly', async () => {
    renderApp(<PublishingPage />, { route: `/publishing?taskId=${publicationTask.id}` });
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('YouTube Việt hóa')).toBeInTheDocument();
    expect(within(dialog).getByText('Version 3')).toBeInTheDocument();
  });

  it('switches between list/calendar and opens the full task workspace', async () => {
    const user = userEvent.setup();
    renderApp(<PublishingPage />, { route: '/publishing' });
    expect((await screen.findAllByText('YouTube Việt hóa')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('tab', { name: 'Lịch' }));
    expect(screen.getByText(/thứ tư/iu)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /YouTube Việt hóa/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Asset bàn giao')).toBeInTheDocument();
    expect(within(dialog).getByText('Metadata')).toBeInTheDocument();
    expect(within(dialog).getByText('Checklist đăng thủ công')).toBeInTheDocument();
    expect(within(dialog).getByText('Publication proof')).toBeInTheDocument();
  });

  it('saves a field through the generated contract with the current strong ETag', async () => {
    const user = userEvent.setup(); let ifMatch: string | null = null; let body: unknown;
    server.use(http.patch(`${CONTROL_PLANE_BASE_URL}/publication-tasks/:taskId/fields/:fieldKey`, async ({ request }) => { ifMatch = request.headers.get('If-Match'); body = await request.json(); const next = { ...publicationTask, version: 4, fields: publicationTask.fields.map((field) => field.key === 'title' ? { ...field, currentRevision: { ...field.currentRevision!, revision: 2, value: 'Tiêu đề đã sửa' } } : field) }; return HttpResponse.json({ data: next, meta: { requestId: READY_REQUEST_ID } }); }));
    renderApp(<PublishingPage />, { route: '/publishing' });
    await user.click((await screen.findAllByRole('button', { name: 'Mở task' }))[0]!);
    const title = await screen.findByLabelText('Tiêu đề');
    await user.clear(title); await user.type(title, 'Tiêu đề đã sửa');
    await user.click(screen.getAllByRole('button', { name: 'Lưu field' })[0]!);
    await waitFor(() => expect(ifMatch).toBe('"3"'));
    expect(body).toEqual({ value: 'Tiêu đề đã sửa' });
    expect(await screen.findByText('Version 4')).toBeInTheDocument();
  });

  it('reads and saves publishing wall-clock values in Asia/Ho_Chi_Minh', async () => {
    const user = userEvent.setup(); let body: unknown;
    server.use(http.patch(`${CONTROL_PLANE_BASE_URL}/publication-tasks/:taskId/plan`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ data: { ...publicationTask, version: 4, ...(body as object) }, meta: { requestId: READY_REQUEST_ID } }); }));
    renderApp(<PublishingPage />, { route: '/publishing' });
    await user.click((await screen.findAllByRole('button', { name: 'Mở task' }))[0]!);
    const scheduledAt = await screen.findByLabelText('Thời gian dự kiến');
    expect(scheduledAt).toHaveValue('2026-09-23T09:00');
    fireEvent.change(scheduledAt, { target: { value: '2026-09-24T00:30' } });
    await user.click(screen.getByRole('button', { name: 'Lưu kế hoạch' }));
    await waitFor(() => expect(body).toMatchObject({ scheduledAt: '2026-09-23T17:30:00.000Z' }));
  });

  it('submits append-only proof with an idempotency key and protects dirty drafts', async () => {
    const user = userEvent.setup(); const posting = { ...publicationTask, status: 'POSTING_MANUAL' as const }; let key: string | null = null;
    server.use(
      http.get(`${CONTROL_PLANE_BASE_URL}/publication-tasks/:taskId`, () => HttpResponse.json({ ...publicationDetailEnvelope, data: posting })),
      http.post(`${CONTROL_PLANE_BASE_URL}/publication-tasks/:taskId/proofs`, async ({ request }) => { key = request.headers.get('Idempotency-Key'); const submitted = await request.json() as { publicUrl: string }; return HttpResponse.json({ data: { ...posting, version: 4, status: 'PUBLISHED', proofs: [{ id: '0191f3d2-7f5b-7abc-8b2e-123456789c09', attemptNumber: 1, platformPostId: null, publicUrl: submitted.publicUrl, verificationStatus: 'PENDING', submittedAt: '2026-09-22T11:00:00.000Z', verifiedAt: null, verificationDetail: null }] }, meta: { requestId: READY_REQUEST_ID } }, { status: 201 }); }),
    );
    renderApp(<PublishingPage />, { route: '/publishing' });
    await user.click((await screen.findAllByRole('button', { name: 'Mở task' }))[0]!);
    await user.type(await screen.findByLabelText('Public URL'), 'https://youtube.example/watch/123');
    await user.click(screen.getByRole('button', { name: 'Ghi nhận proof' }));
    await waitFor(() => expect(key).toMatch(/^[0-9a-f-]{36}$/u));
    expect(await screen.findByText('https://youtube.example/watch/123')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Ghi chú'), ' chưa lưu');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Bỏ thay đổi chưa lưu?');
  });

  it('requests a short-lived download grant without exposing storage identity', async () => {
    const user = userEvent.setup(); const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    server.use(http.post(`${CONTROL_PLANE_BASE_URL}/publication-tasks/:taskId/assets/VIDEO/download-grant`, () => HttpResponse.json({ data: { method: 'GET', url: 'https://download.example/grant?signature=short-lived', expiresAt: '2026-09-22T12:05:00.000Z', fileName: 'output.mp4', contentType: 'video/mp4', byteSize: '128' }, meta: { requestId: READY_REQUEST_ID } })));
    renderApp(<PublishingPage />, { route: '/publishing' });
    await user.click((await screen.findAllByRole('button', { name: 'Mở task' }))[0]!);
    await user.click(await screen.findByRole('button', { name: 'Tải video' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(expect.stringContaining('https://download.example/grant'), '_blank', 'noopener,noreferrer'));
    expect(screen.queryByText(/bucket|objectKey/iu)).not.toBeInTheDocument();
  });
});
