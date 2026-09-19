import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { Toaster } from '@/components/ui/sonner';

import { CONTROL_PLANE_BASE_URL, SETTINGS_PATH, settingsEnvelope } from '../../../test/fixtures/control-plane';
import { server } from '../../../test/msw/server';
import { renderApp } from '../../../test/test-utils';
import { SettingsPage } from './settings-page';

describe('SettingsPage', () => {
  it('hydrates non-secret fields and never puts a stored secret into the input', async () => {
    renderApp(<SettingsPage />);

    expect(await screen.findByLabelText('Model')).toHaveValue('claude-sonnet-5');
    expect(screen.getByLabelText('API key')).toHaveValue('');
    expect(screen.getByLabelText('API key')).toHaveAttribute('placeholder', 'Đã lưu · ••••3f8a');
    expect(screen.getByLabelText('Access Key ID')).toHaveValue('');
  });

  it('sends only changed fields with concurrency and idempotency headers', async () => {
    const user = userEvent.setup();
    const requestSpy = vi.fn();
    server.use(http.patch(`${CONTROL_PLANE_BASE_URL}${SETTINGS_PATH}`, async ({ request }) => {
      requestSpy({ headers: request.headers, body: await request.json() });
      return HttpResponse.json(
        { ...settingsEnvelope, data: { ...settingsEnvelope.data, version: 4, retention: { ...settingsEnvelope.data.retention, rawVideoDays: 14 } } },
        { headers: { ETag: '"4"', 'X-Request-Id': settingsEnvelope.meta.requestId } },
      );
    }));
    renderApp(<><SettingsPage /><Toaster /></>);
    const rawDays = await screen.findByLabelText('Video gốc');
    await user.clear(rawDays);
    await user.type(rawDays, '14');
    await user.click(screen.getByRole('button', { name: 'Lưu cài đặt' }));

    await waitFor(() => expect(requestSpy).toHaveBeenCalledOnce());
    const request = requestSpy.mock.calls[0]?.[0] as { headers: Headers; body: unknown };
    expect(request.headers.get('If-Match')).toBe('"3"');
    expect(request.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/u);
    expect(request.body).toEqual({ retention: { rawVideoDays: 14 } });
    await waitFor(() => expect(screen.getByText('Mọi thay đổi đã được lưu')).toBeInTheDocument());
    expect(screen.getByLabelText('API key')).toHaveValue('');
  });

  it('tests the current draft with stored credentials when secret fields stay empty', async () => {
    const user = userEvent.setup();
    const requestSpy = vi.fn();
    server.use(http.post(`${CONTROL_PLANE_BASE_URL}${SETTINGS_PATH}/tests/content-agent`, async ({ request }) => {
      requestSpy(await request.json());
      return HttpResponse.json({
        data: { status: 'CONNECTED', latencyMs: 42, checkedAt: '2026-09-19T12:00:00.000Z', message: 'ok' },
        meta: settingsEnvelope.meta,
      });
    }));
    renderApp(<><SettingsPage /><Toaster /></>);
    await screen.findByLabelText('Model');
    await user.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));

    await waitFor(() => expect(requestSpy).toHaveBeenCalledWith({
      provider: 'ANTHROPIC', model: 'claude-sonnet-5', credential: { source: 'STORED' },
    }));
  });

  it('reloads the latest snapshot instead of overwriting a version conflict', async () => {
    const user = userEvent.setup();
    let reads = 0;
    server.use(
      http.get(`${CONTROL_PLANE_BASE_URL}${SETTINGS_PATH}`, () => {
        reads += 1;
        const version = reads === 1 ? 3 : 4;
        return HttpResponse.json(
          { ...settingsEnvelope, data: { ...settingsEnvelope.data, version, retention: { ...settingsEnvelope.data.retention, rawVideoDays: version === 3 ? 7 : 20 } } },
          { headers: { ETag: `"${version}"`, 'X-Request-Id': settingsEnvelope.meta.requestId } },
        );
      }),
      http.patch(`${CONTROL_PLANE_BASE_URL}${SETTINGS_PATH}`, () => HttpResponse.json({
        type: 'about:blank', title: 'Conflict', status: 409, instance: SETTINGS_PATH,
        code: 'VERSION_CONFLICT', requestId: settingsEnvelope.meta.requestId,
      }, { status: 409, headers: { 'Content-Type': 'application/problem+json' } })),
    );
    renderApp(<><SettingsPage /><Toaster /></>);
    const rawDays = await screen.findByLabelText('Video gốc');
    await user.clear(rawDays);
    await user.type(rawDays, '14');
    await user.click(screen.getByRole('button', { name: 'Lưu cài đặt' }));

    expect(await screen.findByText(/Cài đặt đã thay đổi ở nơi khác/u)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Video gốc')).toHaveValue('20'));
    expect(reads).toBeGreaterThanOrEqual(2);
  });
});
