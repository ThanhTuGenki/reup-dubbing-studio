import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderApp } from '@/test/test-utils';
import { CONTROL_PLANE_BASE_URL, READY_REQUEST_ID, sourceAccount } from '@/test/fixtures/control-plane';
import { server } from '@/test/msw/server';
import { DiscoveryPage } from './discovery-page';

describe('DiscoveryPage', () => {
  it('lists sanitized source content and supports local selection', async () => {
    const user = userEvent.setup(); renderApp(<DiscoveryPage />);
    expect(await screen.findByText('Mẹo học tiếng Trung')).toBeInTheDocument();
    expect(screen.getByText('Học mỗi ngày')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Chọn Mẹo học tiếng Trung' }));
    expect(screen.getByText('1 đã chọn')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mở nội dung nguồn' })).toHaveAttribute('href', 'https://www.douyin.com/video/999999999999999999');
  });

  it('shows watchlist controls without downloading media', async () => {
    const user = userEvent.setup(); renderApp(<DiscoveryPage />);
    await user.click(await screen.findByRole('tab', { name: 'Watchlist' }));
    expect(await screen.findByText('1 nguồn đang theo dõi')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Tự quét Học mỗi ngày' })).toBeChecked();
    expect(document.querySelector('video, audio')).toBeNull();
  });

  it('shows expired credential health and prevents a scan', async () => {
    server.use(http.get(`${CONTROL_PLANE_BASE_URL}/source-accounts`, () => HttpResponse.json({ data: { items: [{ ...sourceAccount, status: 'EXPIRED' }] }, meta: { requestId: READY_REQUEST_ID } })));
    renderApp(<DiscoveryPage />);
    expect(await screen.findByText('EXPIRED')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bắt đầu quét' })).toBeDisabled();
  });

  it('keeps partial results visible and explains a rate limit safely', async () => {
    const partialRun = { id: '0191f3d2-7f5b-7abc-8b2e-123456789af3', sourceAccountId: sourceAccount.id, mode: 'JINGXUAN', status: 'PARTIAL', input: null, query: null, categoryId: null, watchlistId: null, requestedLimit: 50, pageCount: 1, itemCount: 1, skippedCounts: {}, errorCode: 'DISCOVERY_RATE_LIMITED', errorDetail: 'Provider rate limit; retry after cooldown.', version: 3, startedAt: '2026-09-20T08:29:00.000Z', finishedAt: '2026-09-20T08:30:00.000Z', createdAt: '2026-09-20T08:29:00.000Z', updatedAt: '2026-09-20T08:30:00.000Z' };
    server.use(http.post(`${CONTROL_PLANE_BASE_URL}/discovery/runs`, () => HttpResponse.json({ data: { ...partialRun, status: 'QUEUED', version: 1, pageCount: 0, itemCount: 0, errorCode: null, errorDetail: null, startedAt: null, finishedAt: null }, meta: { requestId: READY_REQUEST_ID } }, { status: 202 })), http.get(`${CONTROL_PLANE_BASE_URL}/discovery/runs/:runId`, () => HttpResponse.json({ data: partialRun, meta: { requestId: READY_REQUEST_ID } })));
    const user = userEvent.setup(); renderApp(<DiscoveryPage />);
    await user.click(await screen.findByRole('button', { name: 'Bắt đầu quét' }));
    expect(await screen.findByText('PARTIAL')).toBeInTheDocument();
    expect(screen.getByText(/retry after cooldown/u)).toBeInTheDocument();
    expect(screen.getByText('Mẹo học tiếng Trung')).toBeInTheDocument();
  });
});
