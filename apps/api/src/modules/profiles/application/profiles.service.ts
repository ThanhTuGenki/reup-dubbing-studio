import { createHash } from 'node:crypto';

import type { ProfileRepository } from './ports';
import { ProfileError } from '../domain/profile-errors';
import type {
  CreateChannelProfile,
  CreateSeriesProfile,
  ProfileListQuery,
  SubtitleMask,
  UpdateChannelProfile,
  UpdateSeriesProfile,
} from '../domain/profiles';

export class ProfilesService {
  constructor(private readonly repository: ProfileRepository) {}

  listChannels(query: ProfileListQuery) { return this.repository.listChannels(query); }
  getChannel(id: string) { return this.repository.getChannel(id); }

  createChannel(input: CreateChannelProfile, idempotencyKey: string) {
    validateChannel(input);
    return this.repository.createChannel(input, idempotencyKey, hash(input));
  }

  updateChannel(id: string, expectedVersion: number, input: UpdateChannelProfile) {
    if (Object.keys(input).length === 0) fail('Channel profile patch cannot be empty');
    validateChannelPatch(input);
    return this.repository.updateChannel(id, expectedVersion, input);
  }

  archiveChannel(id: string, expectedVersion: number) {
    return this.repository.archiveChannel(id, expectedVersion);
  }

  restoreChannel(id: string, expectedVersion: number) {
    return this.repository.restoreChannel(id, expectedVersion);
  }

  listSeries(query: ProfileListQuery) { return this.repository.listSeries(query); }
  getSeries(id: string) { return this.repository.getSeries(id); }

  createSeries(input: CreateSeriesProfile, idempotencyKey: string) {
    validateName(input.name);
    validateMask(input.mask);
    if (hasNull(input, 'overrides')) fail('Series overrides must be an object');
    validateOverrides(input.overrides);
    return this.repository.createSeries(input, idempotencyKey, hash(input));
  }

  updateSeries(id: string, expectedVersion: number, expectedParentVersion: number, input: UpdateSeriesProfile) {
    if (Object.keys(input).length === 0) fail('Series profile patch cannot be empty');
    rejectNulls(input, ['name', 'status', 'overrides']);
    if (input.name !== undefined) validateName(input.name);
    validateMask(input.mask);
    validateOverrides(input.overrides);
    return this.repository.updateSeries(id, expectedVersion, expectedParentVersion, input);
  }

  archiveSeries(id: string, version: number, parentVersion: number) {
    return this.repository.archiveSeries(id, version, parentVersion);
  }

  restoreSeries(id: string, version: number, parentVersion: number) {
    return this.repository.restoreSeries(id, version, parentVersion);
  }

  snapshotForJob(channelProfileId: string, seriesProfileId?: string) {
    return this.repository.snapshotForJob({ channelProfileId, ...(seriesProfileId ? { seriesProfileId } : {}) });
  }
}

function validateChannel(input: CreateChannelProfile): void {
  validateName(input.name);
  validatePipeline(input.pipeline);
  validateContent(input.content);
  validateDestinations(input.destinations);
}

function validateChannelPatch(input: UpdateChannelProfile): void {
  rejectNulls(input, ['name', 'status', 'pipeline', 'content', 'destinations']);
  if (input.name !== undefined) validateName(input.name);
  if (input.pipeline) {
    if (Object.keys(input.pipeline).length === 0) fail('Pipeline patch cannot be empty');
    validatePipelinePatch(input.pipeline);
  }
  if (input.content) {
    if (Object.keys(input.content).length === 0) fail('Content patch cannot be empty');
    rejectNulls(input.content, ['voiceRules', 'metadataTemplate', 'baseKeywords']);
    validateContent({
      voiceRules: input.content.voiceRules ?? {},
      ctaTemplate: input.content.ctaTemplate ?? null,
      metadataTemplate: input.content.metadataTemplate ?? {},
      baseKeywords: input.content.baseKeywords ?? [],
    });
  }
  if (input.destinations) validateDestinations(input.destinations);
}

function validateName(name: string): void {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) fail('Profile name must contain 1 to 120 characters');
}

function validatePipeline(input: CreateChannelProfile['pipeline']): void {
  validatePipelinePatch(input);
  if (!input.targetLanguage || !input.subtitleLanguage || !input.subtitleFilenameRule) {
    fail('Language and subtitle filename rule are required');
  }
}

function validatePipelinePatch(input: Partial<CreateChannelProfile['pipeline']>): void {
  rejectNulls(input, [
    'targetLanguage', 'voiceMode', 'subtitleLanguage', 'subtitleFilenameRule',
    'ttsSpeed', 'timingPolicy', 'removeHardSubEnabled', 'output16x9Enabled', 'output9x16Enabled',
  ]);
  for (const language of [input.targetLanguage, input.subtitleLanguage]) {
    if (language !== undefined && !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(language)) fail('Invalid BCP 47 language tag');
  }
  if (input.subtitleFilenameRule !== undefined && (!input.subtitleFilenameRule.trim() || input.subtitleFilenameRule.length > 200)) fail('Invalid subtitle filename rule');
  if (input.subtitleMaxLineLength !== undefined && input.subtitleMaxLineLength !== null
    && (!Number.isInteger(input.subtitleMaxLineLength) || input.subtitleMaxLineLength < 1 || input.subtitleMaxLineLength > 500)) fail('Invalid subtitle max line length');
  if (input.ttsSpeed !== undefined && (!Number.isFinite(input.ttsSpeed) || input.ttsSpeed < 0.5 || input.ttsSpeed > 2)) fail('Invalid TTS speed');
}

function validateContent(input: CreateChannelProfile['content']): void {
  if (!isPlainObject(input.voiceRules) || !isPlainObject(input.metadataTemplate)) fail('Content templates must be objects');
  if (input.ctaTemplate !== null && input.ctaTemplate.length > 4000) fail('CTA template is too long');
  if (input.baseKeywords.length > 100 || input.baseKeywords.some((item) => !item.trim() || item.length > 100)) fail('Invalid base keywords');
}

function validateDestinations(input: CreateChannelProfile['destinations']): void {
  const identities = new Set<string>();
  for (const item of input) {
    if (!item.displayName.trim() || item.displayName.length > 200 || !isPlainObject(item.platformConfig)) fail('Invalid publishing destination');
    const identity = `${item.platform}:${(item.externalId ?? item.displayName).trim().toLocaleLowerCase('en-US')}`;
    if (identities.has(identity)) fail('Publishing destinations must be unique');
    identities.add(identity);
  }
}

function validateOverrides(input: CreateSeriesProfile['overrides'] | undefined): void {
  if (!input) return;
  if (Object.keys(input).length === 0) fail('Series overrides cannot be empty');
  validatePipelinePatch(Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== null),
  ) as Partial<CreateChannelProfile['pipeline']>);
}

function validateMask(mask: SubtitleMask | null | undefined): void {
  if (mask === undefined || mask === null) return;
  const values = [mask.x, mask.y, mask.width, mask.height];
  if (values.some((value) => !Number.isFinite(value)) || mask.x < 0 || mask.y < 0
    || mask.width <= 0 || mask.height <= 0 || mask.x + mask.width > 1 || mask.y + mask.height > 1) {
    throw new ProfileError('PROFILE_MASK_INVALID', 'Mask must be a normalized rectangle inside the frame');
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectNulls(value: object, keys: string[]): void {
  const record = value as Record<string, unknown>;
  if (keys.some((key) => record[key] === null)) fail('Patch contains null for a non-nullable field');
}

function hasNull(value: object, key: string): boolean {
  return (value as Record<string, unknown>)[key] === null;
}

function fail(message: string): never {
  throw new ProfileError('PROFILE_VALIDATION_FAILED', message);
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
