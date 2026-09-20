import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CONTROL_PLANE_BASE_URL, queueDetailEnvelope } from '@/test/fixtures/control-plane';
import { server } from '@/test/msw/server';
import { renderApp } from '@/test/test-utils';
import { QueuePage } from './queue-page';

describe('QueuePage', () => {
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
});
