import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { CONTROL_PLANE_BASE_URL, READY_REQUEST_ID, libraryVideo } from '@/test/fixtures/control-plane';
import { server } from '@/test/msw/server';
import { deleteLibraryVideo, deleteLibraryVideos, type LibraryApiError } from './library-api';

const meta = { requestId: READY_REQUEST_ID };
describe('library deletion API', () => {
  it('sends the version as a strong ETag with an idempotency key', async () => {
    let headers: Headers | null = null;
    server.use(http.delete(`${CONTROL_PLANE_BASE_URL}/videos/:videoId`, ({ request }) => { headers = request.headers; return HttpResponse.json({ data: { videoId: libraryVideo.id, status: 'DELETING', cancelledJobIds: [] }, meta }, { status: 202 }); }));
    await expect(deleteLibraryVideo(libraryVideo, 'delete-key-1')).resolves.toMatchObject({ status: 'DELETING' });
    expect(headers!.get('If-Match')).toBe('"4"');
    expect(headers!.get('Idempotency-Key')).toBe('delete-key-1');
  });

  it('surfaces the problem code when deletion is refused', async () => {
    server.use(http.delete(`${CONTROL_PLANE_BASE_URL}/videos/:videoId`, () => HttpResponse.json({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'Video has publication proof', code: 'VIDEO_HAS_PUBLICATION_HISTORY', requestId: READY_REQUEST_ID }, { status: 409, headers: { 'Content-Type': 'application/problem+json' } })));
    await expect(deleteLibraryVideo(libraryVideo, 'delete-key-2')).rejects.toMatchObject({ code: 'VIDEO_HAS_PUBLICATION_HISTORY' } satisfies Partial<LibraryApiError>);
  });

  it('returns bulk results in request order', async () => {
    server.use(http.post(`${CONTROL_PLANE_BASE_URL}/videos/deletions`, async ({ request }) => { const body = await request.json() as { items: Array<{ videoId: string }> }; return HttpResponse.json({ data: { items: body.items.map((item) => ({ videoId: item.videoId, result: 'ACCEPTED', cancelledJobIds: [] })) }, meta }); }));
    await expect(deleteLibraryVideos([{ videoId: libraryVideo.id, version: 4 }], 'bulk-key-1')).resolves.toEqual([{ videoId: libraryVideo.id, result: 'ACCEPTED', cancelledJobIds: [] }]);
  });
});
