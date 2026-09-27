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
    const user = userEvent.setup();
    renderApp(<VoiceProfileSelect id="voice" value="" onChange={vi.fn()} />);
    const trigger = screen.getByRole('combobox');
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Chưa chọn giọng', 'Giọng kể ấm · Tiếng Việt',
    ]);
  });

  it('disables the select and shows a loading label while fetching', () => {
    renderApp(<VoiceProfileSelect id="voice" value="" onChange={vi.fn()} />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent('Đang tải giọng…');
  });

  it('preserves and keeps selected a voice id no longer in the usable list', async () => {
    server.use(http.get(`${CONTROL_PLANE_BASE_URL}/voice-profiles`, () => HttpResponse.json(
      { data: { items: [], nextCursor: null }, meta: { requestId: READY_REQUEST_ID } },
    )));
    renderApp(<VoiceProfileSelect id="voice" value={voiceProfile.id} onChange={vi.fn()} />);
    const trigger = screen.getByRole('combobox');
    await waitFor(() => expect(trigger).toBeEnabled());
    expect(trigger).toHaveTextContent('Giọng không còn dùng được');
  });

  it('sends the id of the picked voice', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderApp(<VoiceProfileSelect id="voice" value="" onChange={onChange} />);
    const trigger = screen.getByRole('combobox');
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: 'Giọng kể ấm · Tiếng Việt' }));
    expect(onChange).toHaveBeenCalledWith(voiceProfile.id);
  });

  it('follows nextCursor to load every usable voice, labelling one only on page 2 by name', async () => {
    const user = userEvent.setup();
    const page2Voice = { ...voiceProfile, id: '0191f3d2-7f5b-7abc-8b2e-123456789ae9', name: 'Giọng trang 2' };
    server.use(http.get(`${CONTROL_PLANE_BASE_URL}/voice-profiles`, ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      if (!cursor) return HttpResponse.json({ data: { items: [voiceProfile], nextCursor: 'page-2' }, meta: { requestId: READY_REQUEST_ID } });
      return HttpResponse.json({ data: { items: [page2Voice], nextCursor: null }, meta: { requestId: READY_REQUEST_ID } });
    }));
    renderApp(<VoiceProfileSelect id="voice" value={page2Voice.id} onChange={vi.fn()} />);
    const trigger = screen.getByRole('combobox');
    await waitFor(() => expect(trigger).toBeEnabled());
    expect(trigger).toHaveTextContent(`${page2Voice.name} · Tiếng Việt`);
    await user.click(trigger);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Chưa chọn giọng', 'Giọng kể ấm · Tiếng Việt', 'Giọng trang 2 · Tiếng Việt',
    ]);
  });

  it('stops paging when a buggy API returns an empty page with a cursor that never advances', async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(http.get(`${CONTROL_PLANE_BASE_URL}/voice-profiles`, () => {
      calls += 1;
      return HttpResponse.json({ data: { items: [], nextCursor: 'stuck' }, meta: { requestId: READY_REQUEST_ID } });
    }));
    renderApp(<VoiceProfileSelect id="voice" value="" onChange={vi.fn()} />);
    const trigger = screen.getByRole('combobox');
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Chưa chọn giọng']);
    expect(calls).toBeLessThanOrEqual(20);
  }, 10_000);
});
