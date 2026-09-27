import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/test-utils';
import { ProfilesPage } from './profiles-page';

describe('ProfilesPage', () => {
  it('shows Channel list and Series inheritance sources', async () => {
    const user = userEvent.setup();
    renderApp(<ProfilesPage />);
    expect(await screen.findByText('Kênh Việt hóa')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Series Profiles' }));
    await user.click(await screen.findByText('Tổng tài tập ngắn'));
    expect(await screen.findAllByText('Kế thừa')).not.toHaveLength(0);
    expect(await screen.findAllByText('Ghi đè')).not.toHaveLength(0);
  });

  it('shows language config rows by name instead of raw codes', async () => {
    const user = userEvent.setup();
    renderApp(<ProfilesPage />);
    await user.click(await screen.findByText('Kênh Việt hóa'));
    expect(await screen.findByText('Ngôn ngữ đích')).toBeInTheDocument();
    expect(screen.getAllByText('Tiếng Việt').length).toBeGreaterThan(0);
    expect(screen.queryByText('vi', { selector: 'dd' })).not.toBeInTheDocument();
  });
});
