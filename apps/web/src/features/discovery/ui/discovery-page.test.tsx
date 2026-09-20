import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/test-utils';
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
});
