import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { CONTROL_PLANE_BASE_URL, dashboardEnvelope } from '@/test/fixtures/control-plane';
import { server } from '@/test/msw/server';
import { renderApp } from '@/test/test-utils';

import { DashboardPage } from './dashboard-page';

describe('DashboardPage', () => {
  it('renders the generated projection and API-provided deep links', async () => {
    renderApp(<DashboardPage />);

    expect(await screen.findByRole('heading', { name: 'Tổng quan vận hành' })).toBeInTheDocument();
    expect(screen.getByText('Job đang chờ GPU')).toBeInTheDocument();
    expect(screen.getByText('Đã gửi bằng chứng đăng bài')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Job đang chờ GPU/ })).toHaveAttribute('href', '/queue');
    expect(screen.getByText('13.000 CP')).toBeInTheDocument();
  });

  it('navigates through a quick action', async () => {
    const user = userEvent.setup();
    renderApp(<DashboardPage />);
    await screen.findByRole('heading', { name: 'Tổng quan vận hành' });

    const action = screen.getByRole('link', { name: /Khám phá video/ });
    expect(action).toHaveAttribute('href', '/discovery');
    await user.click(action);
    expect(action).toHaveAttribute('href', '/discovery');
  });

  it('renders empty feeds and a partial VND estimate without inventing data', async () => {
    server.use(http.get(`${CONTROL_PLANE_BASE_URL}/dashboard`, () => HttpResponse.json({
      ...dashboardEnvelope,
      data: {
        ...dashboardEnvelope.data,
        cost: { openBillingSessions: 1, estimatedCostCp: '250.500000', estimatedCostVnd: '120000.00', vndCoverage: 'PARTIAL' },
        attention: { items: [], total: 0 },
        recentActivity: { items: [] },
      },
    })));

    renderApp(<DashboardPage />);
    expect(await screen.findByText('Không có việc khẩn cấp')).toBeInTheDocument();
    expect(screen.getByText('Chưa có hoạt động')).toBeInTheDocument();
    expect(screen.getByText(/dữ liệu quy đổi một phần/)).toBeInTheDocument();
  });

  it('offers retry when the Dashboard API is unavailable', async () => {
    server.use(http.get(`${CONTROL_PLANE_BASE_URL}/dashboard`, () => HttpResponse.json({ title: 'Unavailable', status: 503 }, { status: 503 })));
    renderApp(<DashboardPage />);
    expect(await screen.findByText('Không thể tải tổng quan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });
});
