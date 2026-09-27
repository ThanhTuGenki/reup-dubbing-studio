import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderApp } from '@/test/test-utils';
import { server } from '@/test/msw/server';
import { CONTROL_PLANE_BASE_URL, READY_REQUEST_ID, voiceProfile } from '@/test/fixtures/control-plane';
import { VoiceProfileSelect } from './voice-profile-select';

describe('VoiceProfileSelect', () => {
  it('lists usable voices by name and language, with an empty "not chosen" option', async () => {
    renderApp(<VoiceProfileSelect id="voice" value="" onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled());
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Chưa chọn giọng', 'Giọng kể ấm · Tiếng Việt',
    ]);
  });

  it('disables the select and shows a loading label while fetching', () => {
    renderApp(<VoiceProfileSelect id="voice" value="" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Đang tải giọng…' })).toBeInTheDocument();
  });

  it('preserves and keeps selected a voice id no longer in the usable list', async () => {
    server.use(http.get(`${CONTROL_PLANE_BASE_URL}/voice-profiles`, () => HttpResponse.json(
      { data: { items: [], nextCursor: null }, meta: { requestId: READY_REQUEST_ID } },
    )));
    renderApp(<VoiceProfileSelect id="voice" value={voiceProfile.id} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled());
    const select = screen.getByRole('combobox');
    expect(select).toHaveDisplayValue('Giọng không còn dùng được');
  });

  it('sends the id of the picked voice', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderApp(<VoiceProfileSelect id="voice" value="" onChange={onChange} />);
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled());
    await user.selectOptions(screen.getByRole('combobox'), 'Giọng kể ấm · Tiếng Việt');
    expect(onChange).toHaveBeenCalledWith(voiceProfile.id);
  });
});
