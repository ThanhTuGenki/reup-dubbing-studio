import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  CONTROL_PLANE_BASE_URL,
  createProblemDetails,
  READINESS_PATH,
  READY_REQUEST_ID,
} from '../../test/fixtures/control-plane';
import { server } from '../../test/msw/server';
import { checkReadiness, ControlPlaneError } from './control-plane';

const baseUrl = CONTROL_PLANE_BASE_URL;
describe('Control Plane boundary', () => {
  it('accepts the generated success envelope', async () => {
    await expect(checkReadiness({ baseUrl })).resolves.toEqual({ status: 'ready', requestId: READY_REQUEST_ID });
  });
  it('normalizes Problem Details and retains its request ID', async () => {
    server.use(http.get(`${baseUrl}${READINESS_PATH}`, () => HttpResponse.json(
      createProblemDetails({ title: 'Unavailable' }),
      { status: 503, headers: { 'X-Request-Id': READY_REQUEST_ID } },
    )));
    await expect(checkReadiness({ baseUrl })).rejects.toMatchObject({ kind: 'http', requestId: READY_REQUEST_ID, message: 'Control Plane chưa sẵn sàng.' });
  });
  it('rejects a malformed success response', async () => {
    server.use(http.get(`${baseUrl}${READINESS_PATH}`, () => HttpResponse.json({ status: 'ok', secret: 'hidden' })));
    await expect(checkReadiness({ baseUrl })).rejects.toBeInstanceOf(ControlPlaneError);
  });
  it('turns an elapsed deadline into a safe timeout', async () => {
    const hangingFetch = (request: Request) => new Promise<Response>((_resolve, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true }));
    await expect(checkReadiness({ baseUrl, timeoutMs: 5, fetch: hangingFetch })).rejects.toMatchObject({ kind: 'timeout' });
  });
});
