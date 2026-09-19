import { http, HttpResponse } from 'msw';

import {
  CONTROL_PLANE_BASE_URL,
  liveEnvelope,
  LIVENESS_PATH,
  readyEnvelope,
  READINESS_PATH,
  SETTINGS_PATH,
  settingsEnvelope,
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
];
