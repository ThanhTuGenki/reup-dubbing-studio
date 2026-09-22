import { http, HttpResponse } from 'msw';

import {
  CONTROL_PLANE_BASE_URL,
  liveEnvelope,
  LIVENESS_PATH,
  readyEnvelope,
  READY_REQUEST_ID,
  READINESS_PATH,
  SETTINGS_PATH,
  settingsEnvelope,
  channelProfile,
  channelProfilesEnvelope,
  seriesProfile,
  seriesProfilesEnvelope,
  channelReviewPolicy,
  seriesReviewPolicy,
  voiceProfile,
  voiceProfilesEnvelope,
  sourceAccount,
  discoveryCategory,
  discoveryItem,
  discoveryWatchlist,
  ingestCreateEnvelope,
  ingestPreflightEnvelope,
  queueDetailEnvelope,
  queueListEnvelope,
  gpuWorker,
  safeWorker,
  workerImagesEnvelope,
  workerListEnvelope,
} from '../fixtures/control-plane';

export const handlers = [
  http.get(`${CONTROL_PLANE_BASE_URL}${LIVENESS_PATH}`, () => HttpResponse.json(
    liveEnvelope,
    { headers: { 'X-Request-Id': liveEnvelope.meta.requestId } },
  )),
  http.get(`${CONTROL_PLANE_BASE_URL}${READINESS_PATH}`, () => HttpResponse.json(
    readyEnvelope,
    { headers: { 'X-Request-Id': readyEnvelope.meta.requestId } },
  )),
  http.get(`${CONTROL_PLANE_BASE_URL}${SETTINGS_PATH}`, () => HttpResponse.json(
    settingsEnvelope,
    { headers: { ETag: '"3"', 'X-Request-Id': settingsEnvelope.meta.requestId } },
  )),
  http.get(`${CONTROL_PLANE_BASE_URL}/channel-profiles`, () => HttpResponse.json(
    channelProfilesEnvelope,
    { headers: { 'X-Request-Id': channelProfilesEnvelope.meta.requestId } },
  )),
  http.get(`${CONTROL_PLANE_BASE_URL}/channel-profiles/:channelProfileId/review-policy`, () => HttpResponse.json(
    { data: channelReviewPolicy, meta: { requestId: READY_REQUEST_ID } },
    { headers: { ETag: '"2"', 'X-Request-Id': READY_REQUEST_ID } },
  )),
  http.patch(`${CONTROL_PLANE_BASE_URL}/channel-profiles/:channelProfileId/review-policy`, async ({ request }) => {
    const body = await request.json() as Partial<typeof channelReviewPolicy.stored>;
    const next = { ...channelReviewPolicy, stored: { ...channelReviewPolicy.stored, ...body }, effective: { ...channelReviewPolicy.effective, ...body }, version: 3 };
    return HttpResponse.json({ data: next, meta: { requestId: READY_REQUEST_ID } }, { headers: { ETag: '"3"' } });
  }),
  http.get(`${CONTROL_PLANE_BASE_URL}/channel-profiles/:channelProfileId`, () => HttpResponse.json(
    { data: channelProfile, meta: { requestId: channelProfilesEnvelope.meta.requestId } },
    { headers: { ETag: '"3"', 'X-Request-Id': channelProfilesEnvelope.meta.requestId } },
  )),
  http.get(`${CONTROL_PLANE_BASE_URL}/series-profiles`, () => HttpResponse.json(
    seriesProfilesEnvelope,
    { headers: { 'X-Request-Id': seriesProfilesEnvelope.meta.requestId } },
  )),
  http.get(`${CONTROL_PLANE_BASE_URL}/series-profiles/:seriesProfileId/review-policy`, () => HttpResponse.json(
    { data: seriesReviewPolicy, meta: { requestId: READY_REQUEST_ID } },
    { headers: { ETag: '"3:2"', 'X-Request-Id': READY_REQUEST_ID } },
  )),
  http.patch(`${CONTROL_PLANE_BASE_URL}/series-profiles/:seriesProfileId/review-policy`, async ({ request }) => {
    const body = await request.json() as Partial<typeof seriesReviewPolicy.stored>;
    const stored = { ...seriesReviewPolicy.stored, ...body };
    const next = { ...seriesReviewPolicy, stored, effective: {
      castGate: stored.castGate ?? channelReviewPolicy.effective.castGate,
      scriptGate: stored.scriptGate ?? channelReviewPolicy.effective.scriptGate,
      ttsGate: stored.ttsGate ?? channelReviewPolicy.effective.ttsGate,
      renderGate: stored.renderGate ?? channelReviewPolicy.effective.renderGate,
      publishContentGate: stored.publishContentGate ?? channelReviewPolicy.effective.publishContentGate,
      autoRequestRender: stored.autoRequestRender ?? channelReviewPolicy.effective.autoRequestRender,
    }, version: 4 };
    return HttpResponse.json({ data: next, meta: { requestId: READY_REQUEST_ID } }, { headers: { ETag: '"4:2"' } });
  }),
  http.get(`${CONTROL_PLANE_BASE_URL}/series-profiles/:seriesProfileId`, () => HttpResponse.json(
    { data: seriesProfile, meta: { requestId: seriesProfilesEnvelope.meta.requestId } },
    { headers: { ETag: '"2:3"', 'X-Request-Id': seriesProfilesEnvelope.meta.requestId } },
  )),
  http.get(`${CONTROL_PLANE_BASE_URL}/voice-profiles`, () => HttpResponse.json(
    voiceProfilesEnvelope,
    { headers: { 'X-Request-Id': voiceProfilesEnvelope.meta.requestId } },
  )),
  http.get(`${CONTROL_PLANE_BASE_URL}/voice-profiles/:voiceProfileId`, () => HttpResponse.json(
    { data: voiceProfile, meta: { requestId: voiceProfilesEnvelope.meta.requestId } },
    { headers: { ETag: '"3"', 'X-Request-Id': voiceProfilesEnvelope.meta.requestId } },
  )),
  http.get(`${CONTROL_PLANE_BASE_URL}/source-accounts`, () => HttpResponse.json({ data: { items: [sourceAccount] }, meta: { requestId: READY_REQUEST_ID } })),
  http.get(`${CONTROL_PLANE_BASE_URL}/discovery/categories`, () => HttpResponse.json({ data: { items: [discoveryCategory] }, meta: { requestId: READY_REQUEST_ID } })),
  http.get(`${CONTROL_PLANE_BASE_URL}/discovery/items`, () => HttpResponse.json({ data: { items: [discoveryItem], nextCursor: null }, meta: { requestId: READY_REQUEST_ID } })),
  http.get(`${CONTROL_PLANE_BASE_URL}/watchlists`, () => HttpResponse.json({ data: { items: [discoveryWatchlist] }, meta: { requestId: READY_REQUEST_ID } })),
  http.post(`${CONTROL_PLANE_BASE_URL}/ingest/preflight`, () => HttpResponse.json(ingestPreflightEnvelope)),
  http.post(`${CONTROL_PLANE_BASE_URL}/ingest/jobs`, () => HttpResponse.json(ingestCreateEnvelope, { status: 201 })),
  http.get(`${CONTROL_PLANE_BASE_URL}/queue/jobs`, () => HttpResponse.json(queueListEnvelope)),
  http.get(`${CONTROL_PLANE_BASE_URL}/queue/jobs/:queueJobId`, () => HttpResponse.json(queueDetailEnvelope, { headers: { ETag: '"1"' } })),
  http.get(`${CONTROL_PLANE_BASE_URL}/queue/jobs/:queueJobId/attempts`, () => HttpResponse.json({ data: { items: [], nextCursor: null }, meta: { requestId: READY_REQUEST_ID } })),
  http.post(`${CONTROL_PLANE_BASE_URL}/queue/jobs/:queueJobId/cancel`, () => HttpResponse.json({ ...queueDetailEnvelope, data: { ...queueDetailEnvelope.data, status: 'CANCELLED', version: 2, actions: { canRetry: false, canCancel: false } } })),
  http.post(`${CONTROL_PLANE_BASE_URL}/queue/jobs/:queueJobId/retry`, () => HttpResponse.json(queueDetailEnvelope)),
  http.get(`${CONTROL_PLANE_BASE_URL}/workers`, () => HttpResponse.json(workerListEnvelope)),
  http.get(`${CONTROL_PLANE_BASE_URL}/workers/:workerId`, ({ params }) => HttpResponse.json({ data: params.workerId === safeWorker.id ? safeWorker : gpuWorker, meta: { requestId: READY_REQUEST_ID } })),
  http.get(`${CONTROL_PLANE_BASE_URL}/worker-images`, () => HttpResponse.json(workerImagesEnvelope)),
  http.post(`${CONTROL_PLANE_BASE_URL}/workers`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ data: { worker: { ...gpuWorker, id: '0191f3d2-7f5b-7abc-8b2e-123456789b07', displayName: body.displayName, observedStatus: 'PENDING', currentSession: null, activeLeaseCount: 0, version: 1 }, enrollment: { secretAvailable: true, token: 'enroll_test_secret_once', expiresAt: '2026-09-20T10:15:00.000Z' } }, meta: { requestId: READY_REQUEST_ID } }, { status: 201 });
  }),
  http.post(`${CONTROL_PLANE_BASE_URL}/workers/:workerId/drain`, () => HttpResponse.json({ data: { ...gpuWorker, desiredStatus: 'DRAINING', observedStatus: 'DRAINING', version: 4 }, meta: { requestId: READY_REQUEST_ID } })),
  http.post(`${CONTROL_PLANE_BASE_URL}/workers/:workerId/confirm-termination`, () => HttpResponse.json({ data: { ...safeWorker, observedStatus: 'TERMINATED', version: 6 }, meta: { requestId: READY_REQUEST_ID } })),
];
