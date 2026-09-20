import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CONTROL_PLANE_BASE_URL, createProblemDetails, gpuWorker, workerListEnvelope } from '@/test/fixtures/control-plane';
import { server } from '@/test/msw/server';
import { renderApp } from '@/test/test-utils';
import { WorkersPage } from './workers-page';

describe('WorkersPage', () => {
  it('groups workers and exposes safe runtime details', async () => {
    const user = userEvent.setup();
    renderApp(<WorkersPage />, { route: '/workers' });
    expect(await screen.findByRole('heading', { name: 'Batch Media Workers' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Interactive TTS Workers' })).toBeInTheDocument();
    expect(screen.getByText('batch-a100-01')).toBeInTheDocument();
    expect(screen.getAllByText('slot khả dụng')[0]?.parentElement).toHaveTextContent('2/4');
    await user.click(screen.getAllByRole('button', { name: 'Xem chi tiết' })[0]!);
    expect(await screen.findByRole('dialog')).toHaveTextContent('Shutdown an toàn');
    expect(screen.getByText('Active lease')).toBeInTheDocument();
  });

  it('creates a worker and shows the one-time enrollment token', async () => {
    const user = userEvent.setup();
    renderApp(<WorkersPage />, { route: '/workers' });
    await screen.findByText('batch-a100-01');
    await user.click(screen.getByRole('button', { name: 'Thêm GPU Worker' }));
    await user.type(screen.getByLabelText('Tên hiển thị'), 'batch-l40-02');
    await user.type(screen.getByLabelText('Mã rental/container'), 'ctr-new');
    await user.selectOptions(screen.getByLabelText('Approved image'), '0191f3d2-7f5b-7abc-8b2e-123456789b01');
    await user.type(screen.getByLabelText('Đơn giá (CP/giờ)'), '7000');
    await user.click(screen.getByRole('button', { name: 'Tạo worker và token' }));
    expect(await screen.findByText('Lưu enrollment token ngay')).toBeInTheDocument();
    expect(screen.getByText('enroll_test_secret_once')).toBeInTheDocument();
    expect(screen.getByText('Token dùng một lần · hết hạn sau 15 phút')).toBeInTheDocument();
  });

  it('drains with current version and idempotency key', async () => {
    const user = userEvent.setup();
    let ifMatch: string | null = null;
    let idempotencyKey: string | null = null;
    server.use(http.post(`${CONTROL_PLANE_BASE_URL}/workers/:workerId/drain`, ({ request }) => {
      ifMatch = request.headers.get('If-Match');
      idempotencyKey = request.headers.get('Idempotency-Key');
      return HttpResponse.json({ data: { ...gpuWorker, desiredStatus: 'DRAINING', observedStatus: 'DRAINING', version: 4 }, meta: workerListEnvelope.meta });
    }));
    renderApp(<WorkersPage />, { route: '/workers' });
    await user.click(await screen.findByRole('button', { name: 'Dừng nhận job' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Dừng nhận job' }));
    await waitFor(() => expect(ifMatch).toBe('"3"'));
    expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('refreshes worker state after a version conflict', async () => {
    const user = userEvent.setup();
    let listRequests = 0;
    server.use(
      http.get(`${CONTROL_PLANE_BASE_URL}/workers`, () => {
        listRequests += 1;
        const current = listRequests > 1 ? { ...gpuWorker, observedStatus: 'OFFLINE' as const, version: 4 } : gpuWorker;
        return HttpResponse.json({ ...workerListEnvelope, data: { items: [current], nextCursor: null } });
      }),
      http.post(`${CONTROL_PLANE_BASE_URL}/workers/:workerId/drain`, () => HttpResponse.json(createProblemDetails({ status: 412, code: 'VERSION_CONFLICT', title: 'Stale worker version' }), { status: 412 })),
    );
    renderApp(<WorkersPage />, { route: '/workers' });
    await user.click(await screen.findByRole('button', { name: 'Dừng nhận job' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Dừng nhận job' }));

    expect(await screen.findByText('Mất kết nối')).toBeInTheDocument();
    expect(listRequests).toBeGreaterThanOrEqual(2);
  });
});
