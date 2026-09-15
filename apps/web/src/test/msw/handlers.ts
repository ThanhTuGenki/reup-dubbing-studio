import { http, HttpResponse } from 'msw';

export const READY_REQUEST_ID = '0191f3d2-7f5b-7abc-8b2e-123456789abd';

export const handlers = [
  http.get('http://localhost:3000/v1/health/ready', () => HttpResponse.json(
    { data: { status: 'ok' }, meta: { requestId: READY_REQUEST_ID } },
    { headers: { 'X-Request-Id': READY_REQUEST_ID } },
  )),
];
