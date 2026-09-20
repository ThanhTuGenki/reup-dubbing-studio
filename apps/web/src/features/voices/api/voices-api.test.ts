import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { CONTROL_PLANE_BASE_URL, READY_REQUEST_ID } from '@/test/fixtures/control-plane';
import { server } from '@/test/msw/server';
import { uploadVoiceSample } from './voices-api';

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
