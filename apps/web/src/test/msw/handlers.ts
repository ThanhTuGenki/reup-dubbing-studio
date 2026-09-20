import { http, HttpResponse } from 'msw';

import {
  CONTROL_PLANE_BASE_URL,
  liveEnvelope,
  LIVENESS_PATH,
  readyEnvelope,
  READINESS_PATH,
  SETTINGS_PATH,
  settingsEnvelope,
  channelProfile,
  channelProfilesEnvelope,
  seriesProfile,
  seriesProfilesEnvelope,
  voiceProfile,
  voiceProfilesEnvelope,
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
  http.get(`${CONTROL_PLANE_BASE_URL}/channel-profiles/:channelProfileId`, () => HttpResponse.json(
    { data: channelProfile, meta: { requestId: channelProfilesEnvelope.meta.requestId } },
    { headers: { ETag: '"3"', 'X-Request-Id': channelProfilesEnvelope.meta.requestId } },
  )),
  http.get(`${CONTROL_PLANE_BASE_URL}/series-profiles`, () => HttpResponse.json(
    seriesProfilesEnvelope,
    { headers: { 'X-Request-Id': seriesProfilesEnvelope.meta.requestId } },
  )),
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
];
