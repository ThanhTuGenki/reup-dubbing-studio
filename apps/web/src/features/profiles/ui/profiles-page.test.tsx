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
});
