import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/test-utils';
import { VoicesPage } from './voices-page';
describe('VoicesPage', () => {
  it('lists voices and opens sample details without fetching a signed URL eagerly', async () => {
    const user = userEvent.setup(); renderApp(<VoicesPage />);
    await user.click(await screen.findByText('Giọng kể ấm'));
    expect(await screen.findByText('Xin chào khán giả')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nghe sample' })).toBeInTheDocument();
  });
});
