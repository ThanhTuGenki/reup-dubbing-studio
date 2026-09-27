import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTROL_PLANE_BASE_URL, READY_REQUEST_ID } from '@/test/fixtures/control-plane';
import { server } from '@/test/msw/server';
import { readAudioDurationMs, uploadVoiceSample } from './voices-api';

if (!URL.createObjectURL) {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: () => 'blob:mock' });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: () => undefined });
}

describe('Voice sample asset flow', () => {
  it('uploads with signed headers then commits using optimistic concurrency', async () => {
    const assetId = '0191f3d2-7f5b-7abc-8b2e-123456789ae2'; let uploaded = false; let ifMatch: string | null = null;
    server.use(
      http.post(`${CONTROL_PLANE_BASE_URL}/voice-profiles/:voiceId/samples/uploads`, () => HttpResponse.json({ data: { assetId, method: 'PUT', url: 'https://upload.example/sample', headers: { 'Content-Type': 'audio/wav' }, expiresAt: '2026-09-20T12:10:00.000Z', maxByteSize: 1024 }, meta: { requestId: READY_REQUEST_ID } }, { status: 201 })),
      http.put('https://upload.example/sample', async ({ request }) => { uploaded = request.headers.get('Content-Type') === 'audio/wav' && (await request.arrayBuffer()).byteLength > 0; return new HttpResponse(null, { status: 200 }); }),
      http.post(`${CONTROL_PLANE_BASE_URL}/voice-profiles/:voiceId/samples/uploads/:assetId/commit`, ({ request }) => { ifMatch = request.headers.get('If-Match'); return HttpResponse.json({ data: { sample: { id: '0191f3d2-7f5b-7abc-8b2e-123456789ae1', assetId, language: 'vi', transcript: 'Xin chào', durationMs: 5000, revision: 1 }, profileVersion: 2 }, meta: { requestId: READY_REQUEST_ID } }); }),
    );
    await uploadVoiceSample({ voiceId: '0191f3d2-7f5b-7abc-8b2e-123456789ae0', etag: '"1"', file: new File(['audio'], 'sample.wav', { type: 'audio/wav' }), language: 'vi', transcript: 'Xin chào', durationMs: 5000 });
    expect(uploaded).toBe(true); expect(ifMatch).toBe('"1"');
  });
});

describe('readAudioDurationMs', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | undefined;
  afterEach(() => {
    vi.useRealTimers();
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = undefined;
  });

  it('rejects with a Vietnamese message and revokes the object URL after 15s without a metadata event', async () => {
    vi.useFakeTimers();
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    // jsdom does not implement HTMLMediaElement.load(); silence its expected "not implemented" console noise.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const promise = readAudioDurationMs(new File(['x'], 'sample.wav', { type: 'audio/wav' }));
    const assertion = expect(promise).rejects.toThrow('Không đọc được thời lượng file audio.');
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(revokeSpy).toHaveBeenCalled();
  });
});
