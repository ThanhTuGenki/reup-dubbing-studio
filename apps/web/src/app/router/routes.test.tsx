import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../test/test-utils';
import { AppRoutes } from './routes';

describe('application routes', () => {
  it.each(['/library', '/library/video-1', '/publishing', '/workers'])('keeps the shell for reserved path %s', (route) => {
    renderApp(<AppRoutes />, { route });
    expect(screen.getByRole('heading', { name: 'Tính năng chưa khả dụng' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Điều hướng chính' })).toBeInTheDocument();
  });
  it('renders Queue inside the shell', async () => {
    renderApp(<AppRoutes />, { route: '/queue' });
    expect(await screen.findByRole('heading', { name: 'Hàng đợi xử lý' })).toBeInTheDocument();
    expect((await screen.findAllByText('Video Queue mẫu')).length).toBeGreaterThan(0);
  });
  it('renders Discovery inside the shell', async () => {
    renderApp(<AppRoutes />, { route: '/discovery' });
    expect(await screen.findByRole('heading', { name: 'Khám phá video' })).toBeInTheDocument();
    expect(await screen.findByText('Mẹo học tiếng Trung')).toBeInTheDocument();
  });
  it('renders the Voice Library inside the shell', async () => {
    renderApp(<AppRoutes />, { route: '/voices' });
    expect(await screen.findByRole('heading', { name: 'Thư viện giọng' })).toBeInTheDocument();
    expect(await screen.findByText('Giọng kể ấm')).toBeInTheDocument();
  });
  it('renders the Channel Profiles feature inside the shell', async () => {
    renderApp(<AppRoutes />, { route: '/channel-profiles' });
    expect(await screen.findByRole('heading', { name: 'Channel & Series Profiles' })).toBeInTheDocument();
    expect(await screen.findByText('Kênh Việt hóa')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Điều hướng chính' })).toBeInTheDocument();
  });
  it('renders the Settings feature inside the shell', async () => {
    renderApp(<AppRoutes />, { route: '/settings' });
    expect(await screen.findByRole('heading', { name: 'Cài đặt hệ thống' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Model')).toHaveValue('claude-sonnet-5');
    expect(screen.getByRole('navigation', { name: 'Điều hướng chính' })).toBeInTheDocument();
  });
  it('renders a catch-all with a way home', () => {
    renderApp(<AppRoutes />, { route: '/unknown' });
    expect(screen.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về trang nền tảng' })).toHaveAttribute('href', '/');
  });
});
