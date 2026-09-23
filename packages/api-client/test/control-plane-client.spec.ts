import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createClient,
  getLiveness,
  getReadiness,
  getDashboard,
  getSettings,
  updateSettings,
  testContentAgentConnection,
  testStorageConnection,
  listChannelProfiles,
  createChannelProfile,
  getChannelReviewPolicy,
  updateChannelReviewPolicy,
  listSeriesProfiles,
  createSeriesProfile,
  getSeriesReviewPolicy,
  updateSeriesReviewPolicy,
  previewChannelProfileAsset,
  previewSeriesProfileAsset,
  listVoiceProfiles,
  createVoiceProfile,
  commitVoiceSampleUpload,
  previewVoiceSample,
  listSourceAccounts,
  importSourceCredential,
  createDiscoveryRun,
  listDiscoveryItems,
  createWatchlist,
  runWatchlist,
  preflightIngestJobs,
  createIngestJobs,
  type DiscoveryRun,
  type Settings,
  type ProblemDetails,
  type SuccessEnvelope,
} from '../src';
import clientPackage from '../package.json';

describe('Control Plane client public API', () => {
  it('publishes the complete generated health client boundary', () => {
    expect(createClient).toBeTypeOf('function');
    expect(getLiveness).toBeTypeOf('function');
    expect(getReadiness).toBeTypeOf('function');
    expect(getDashboard).toBeTypeOf('function');
    expect(getSettings).toBeTypeOf('function');
    expect(updateSettings).toBeTypeOf('function');
    expect(testContentAgentConnection).toBeTypeOf('function');
    expect(testStorageConnection).toBeTypeOf('function');
    expect(listChannelProfiles).toBeTypeOf('function');
    expect(createChannelProfile).toBeTypeOf('function');
    expect(getChannelReviewPolicy).toBeTypeOf('function');
    expect(updateChannelReviewPolicy).toBeTypeOf('function');
    expect(listSeriesProfiles).toBeTypeOf('function');
    expect(createSeriesProfile).toBeTypeOf('function');
    expect(getSeriesReviewPolicy).toBeTypeOf('function');
    expect(updateSeriesReviewPolicy).toBeTypeOf('function');
    expect(previewChannelProfileAsset).toBeTypeOf('function');
    expect(previewSeriesProfileAsset).toBeTypeOf('function');
    expect(listVoiceProfiles).toBeTypeOf('function');
    expect(createVoiceProfile).toBeTypeOf('function');
    expect(commitVoiceSampleUpload).toBeTypeOf('function');
    expect(previewVoiceSample).toBeTypeOf('function');
    expect(listSourceAccounts).toBeTypeOf('function');
    expect(importSourceCredential).toBeTypeOf('function');
    expect(createDiscoveryRun).toBeTypeOf('function');
    expect(listDiscoveryItems).toBeTypeOf('function');
    expect(createWatchlist).toBeTypeOf('function');
    expect(runWatchlist).toBeTypeOf('function');
    expect(preflightIngestJobs).toBeTypeOf('function');
    expect(createIngestJobs).toBeTypeOf('function');
    expectTypeOf<DiscoveryRun>().toHaveProperty('status');
    expectTypeOf<Settings>().toHaveProperty('retention');
    expectTypeOf<SuccessEnvelope>().toHaveProperty('meta');
    expectTypeOf<ProblemDetails>().toHaveProperty('requestId');
  });

  it('does not expose internal deep-import paths', () => {
    expect(Object.keys(clientPackage.exports)).toEqual(['.']);
  });
});
