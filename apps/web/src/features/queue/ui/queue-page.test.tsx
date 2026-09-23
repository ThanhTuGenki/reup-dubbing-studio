import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTROL_PLANE_BASE_URL, createProblemDetails, queueDetailEnvelope, queueListEnvelope } from '@/test/fixtures/control-plane';
import { FakeEventSource } from '@/test/fakes/event-source';
import { server } from '@/test/msw/server';
import { renderApp } from '@/test/test-utils';
import { QueuePage } from './queue-page';

describe('QueuePage', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('opens API-owned Dashboard deep links directly', async () => {
    renderApp(<QueuePage />, { route: `/queue?jobId=${queueDetailEnvelope.data.id}` });
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Tiến độ pipeline')).toBeInTheDocument();
    expect(within(dialog).getByText('Version 1')).toBeInTheDocument();
  });

  it('lists safe job progress and opens task details', async () => {
    const user = userEvent.setup();
    renderApp(<QueuePage />, { route: '/queue' });

    expect((await screen.findAllByText('Video Queue mẫu')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('25% · 0/1')[0]).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Chi tiết' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Tiến độ pipeline' })).toBeInTheDocument();
    expect(screen.getByText('Đang chuẩn bị tải', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Chưa có attempt nào.')).toBeInTheDocument();
  });

  it('cancels with the current version and an idempotency key', async () => {
    const user = userEvent.setup();
    let ifMatch: string | null = null;
    let idempotencyKey: string | null = null;
    server.use(http.post(`${CONTROL_PLANE_BASE_URL}/queue/jobs/:queueJobId/cancel`, ({ request }) => {
      ifMatch = request.headers.get('If-Match');
      idempotencyKey = request.headers.get('Idempotency-Key');
      return HttpResponse.json({ ...queueDetailEnvelope, data: { ...queueDetailEnvelope.data, status: 'CANCELLED', version: 2, actions: { canRetry: false, canCancel: false } } });
    }));
    renderApp(<QueuePage />, { route: '/queue' });
    await user.click(await screen.findByRole('button', { name: 'Chi tiết' }));
    await user.click(await screen.findByRole('button', { name: 'Hủy job' }));
    const confirmation = await screen.findByRole('alertdialog');
    await user.click(within(confirmation).getByRole('button', { name: 'Hủy job' }));

    await waitFor(() => expect(ifMatch).toBe('"1"'));
    expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/u);
    expect(await screen.findByText('Version 2')).toBeInTheDocument();
  });

  it('recovers the list after a temporary Control Plane error', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('EventSource', vi.fn(() => new FakeEventSource()));
    let recovering = false;
    server.use(http.get(`${CONTROL_PLANE_BASE_URL}/queue/jobs`, () => {
      return recovering ? HttpResponse.json(queueListEnvelope) : HttpResponse.json(createProblemDetails(), { status: 503 });
    }));
    renderApp(<QueuePage />, { route: '/queue' });

    expect(await screen.findByRole('alert')).toHaveTextContent('Không thể tải hàng đợi');
    recovering = true;
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect((await screen.findAllByText('Video Queue mẫu')).length).toBeGreaterThan(0);
  });

  it('refetches Queue REST state after the SSE connection reconnects', async () => {
    const source = new FakeEventSource();
    vi.stubGlobal('EventSource', vi.fn(() => source));
    let requests = 0;
    server.use(http.get(`${CONTROL_PLANE_BASE_URL}/queue/jobs`, () => { requests += 1; return HttpResponse.json(queueListEnvelope); }));
    renderApp(<QueuePage />, { route: '/queue' });
    await screen.findAllByText('Video Queue mẫu');

    act(() => {
      source.readyState = 1;
      source.emit('open');
      source.readyState = 0;
      source.emit('error');
      source.readyState = 1;
      source.emit('open');
    });

    await waitFor(() => expect(requests).toBeGreaterThanOrEqual(2));
  });

  it('refreshes stale detail after a version conflict', async () => {
    const user = userEvent.setup();
    let detailRequests = 0;
    server.use(
      http.get(`${CONTROL_PLANE_BASE_URL}/queue/jobs/:queueJobId`, () => {
        detailRequests += 1;
        const version = detailRequests > 1 ? 2 : 1;
        return HttpResponse.json({ ...queueDetailEnvelope, data: { ...queueDetailEnvelope.data, version } });
      }),
      http.post(`${CONTROL_PLANE_BASE_URL}/queue/jobs/:queueJobId/cancel`, () => HttpResponse.json(createProblemDetails({ status: 412, code: 'VERSION_CONFLICT', title: 'Stale version' }), { status: 412 })),
    );
    renderApp(<QueuePage />, { route: '/queue' });
    await user.click(await screen.findByRole('button', { name: 'Chi tiết' }));
    await user.click(await screen.findByRole('button', { name: 'Hủy job' }));
    const confirmation = await screen.findByRole('alertdialog');
    await user.click(within(confirmation).getByRole('button', { name: 'Hủy job' }));

    expect(await screen.findByText('Version 2')).toBeInTheDocument();
    expect(detailRequests).toBeGreaterThanOrEqual(2);
  });
});
