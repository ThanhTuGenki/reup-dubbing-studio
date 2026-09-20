import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { renderApp } from '@/test/test-utils';
import { server } from '@/test/msw/server';
import { CONTROL_PLANE_BASE_URL, READY_REQUEST_ID, voiceProfile } from '@/test/fixtures/control-plane';
import { VoicesPage } from './voices-page';
describe('VoicesPage', () => {
  it('lists voices and opens sample details without fetching a signed URL eagerly', async () => {
    const user = userEvent.setup(); renderApp(<VoicesPage />);
    await user.click(await screen.findByText('Giọng kể ấm'));
    expect(await screen.findByText('Xin chào khán giả')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nghe sample' })).toBeInTheDocument();
  });

  it('requests the short-lived preview only after playback is requested', async () => {
    let previewRequests = 0;
    server.use(http.get(`${CONTROL_PLANE_BASE_URL}/voice-profiles/:voiceId/samples/:sampleId/preview`, () => {
      previewRequests += 1;
      return HttpResponse.json({ data: { assetId: voiceProfile.samples[0]!.assetId, method: 'GET', url: 'https://media.example/voice.wav?signature=short-lived', expiresAt: '2026-09-20T12:05:00.000Z', fileName: 'voice.wav', contentType: 'audio/wav', byteSize: 128 }, meta: { requestId: READY_REQUEST_ID } });
    }));
    const user = userEvent.setup(); renderApp(<VoicesPage />);
    await user.click(await screen.findByText('Giọng kể ấm'));
    expect(previewRequests).toBe(0);
    await user.click(await screen.findByRole('button', { name: 'Nghe sample' }));
    expect(previewRequests).toBe(1);
    await waitFor(() => expect(document.querySelector('audio')?.src).toContain('signature=short-lived'));
  });

  it('shows the missing-sample state and readiness issue', async () => {
    const missing = { ...voiceProfile, status: 'DRAFT' as const, samples: [], readiness: 'NEEDS_CONFIGURATION' as const, readinessIssues: ['VOICE_PRIMARY_SAMPLE_REQUIRED' as const] };
    server.use(
      http.get(`${CONTROL_PLANE_BASE_URL}/voice-profiles`, () => HttpResponse.json({ data: { items: [missing], nextCursor: null }, meta: { requestId: READY_REQUEST_ID } })),
      http.get(`${CONTROL_PLANE_BASE_URL}/voice-profiles/:voiceId`, () => HttpResponse.json({ data: missing, meta: { requestId: READY_REQUEST_ID } }, { headers: { ETag: '"3"' } })),
    );
    const user = userEvent.setup(); renderApp(<VoicesPage />); await user.click(await screen.findByText('Giọng kể ấm'));
    expect(await screen.findByText('Chưa có sample.')).toBeInTheDocument();
    expect(screen.getByText('VOICE_PRIMARY_SAMPLE_REQUIRED')).toBeInTheDocument();
  });
});
