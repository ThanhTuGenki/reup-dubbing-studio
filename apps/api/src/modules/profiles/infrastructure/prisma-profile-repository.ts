import type { Prisma, PrismaClient } from '@prisma/client';

import { uuidV7 } from '../../../platform/ids/uuid-v7';
import type { ProfileRepository } from '../application/ports';
import { ProfileError } from '../domain/profile-errors';
import type {
  ChannelProfileView,
  CreateChannelProfile,
  CreateSeriesProfile,
  DestinationInput,
  PipelineConfig,
  ProfileJobSnapshot,
  ProfileList,
  ProfileListQuery,
  SeriesOverrides,
  SeriesProfileView,
  UpdateChannelProfile,
  UpdateSeriesProfile,
} from '../domain/profiles';

const channelInclude = {
  defaultVoice: true,
  destinations: { orderBy: [{ platform: 'asc' as const }, { displayName: 'asc' as const }] },
  assets: { where: { isCurrent: true }, include: { asset: true }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.ChannelProfileInclude;

const seriesInclude = {
  defaultVoiceOverride: true,
  channelProfile: { include: channelInclude },
  assets: { where: { isCurrent: true }, include: { asset: true }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.SeriesProfileInclude;

type ChannelRow = Prisma.ChannelProfileGetPayload<{ include: typeof channelInclude }>;
type SeriesRow = Prisma.SeriesProfileGetPayload<{ include: typeof seriesInclude }>;
type Tx = Prisma.TransactionClient;

export class PrismaProfileRepository implements ProfileRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listChannels(query: ProfileListQuery): Promise<ProfileList<ChannelProfileView>> {
    let after = query.cursor ? decodeCursor(query.cursor) : undefined;
    const selected: ChannelProfileView[] = [];
    while (selected.length <= query.limit) {
      const rows = await this.prisma.channelProfile.findMany({
        where: {
          ...(query.status ? { status: query.status } : { status: { not: 'ARCHIVED' } }),
          ...(query.query ? { name: { contains: query.query, mode: 'insensitive' } } : {}),
          ...(after ? { id: { gt: after } } : {}),
        }, include: channelInclude, orderBy: { id: 'asc' }, take: query.limit + 1,
      });
      selected.push(...rows.map(toChannelView)
        .filter((item) => !query.readiness || item.readiness === query.readiness));
      if (rows.length < query.limit + 1 || rows.length === 0) break;
      after = rows.at(-1)!.id;
    }
    return page(selected, query.limit);
  }

  async getChannel(id: string): Promise<ChannelProfileView> {
    const row = await this.prisma.channelProfile.findUnique({ where: { id }, include: channelInclude });
    if (!row) notFound();
    return toChannelView(row);
  }

  async createChannel(input: CreateChannelProfile, idempotencyKey: string, requestHash: string): Promise<ChannelProfileView> {
    return this.idempotent('CREATE_CHANNEL_PROFILE', idempotencyKey, requestHash, async (tx) => {
      const row = await tx.channelProfile.create({
        data: {
          id: uuidV7(), name: input.name.trim(), normalizedName: normalize(input.name),
          ...channelPipelineData(input.pipeline), ...channelContentData(input.content),
          destinations: { create: input.destinations.map(destinationCreate) },
        },
        include: channelInclude,
      });
      return toChannelView(row);
    });
  }

  async updateChannel(id: string, expectedVersion: number, input: UpdateChannelProfile): Promise<ChannelProfileView> {
    return this.write(async (tx) => {
      const current = await tx.channelProfile.findUnique({ where: { id } });
      if (!current) notFound();
      if (current.status === 'ARCHIVED') throw new ProfileError('PROFILE_ARCHIVED', 'Archived profile must be restored before editing');
      if (current.version !== expectedVersion) conflict();
      if (input.destinations) {
        await tx.publishingDestination.deleteMany({ where: { channelProfileId: id } });
        await tx.publishingDestination.createMany({ data: input.destinations.map((item) => ({ ...destinationCreate(item), channelProfileId: id })) });
      }
      const write = await tx.channelProfile.updateMany({
        where: { id, version: expectedVersion },
        data: {
          version: { increment: 1 },
          ...(input.name !== undefined ? { name: input.name.trim(), normalizedName: normalize(input.name) } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...channelPipelinePatch(input.pipeline), ...channelContentPatch(input.content),
        },
      });
      if (write.count !== 1) conflict();
      const row = await tx.channelProfile.findUniqueOrThrow({ where: { id }, include: channelInclude });
      const view = toChannelView(row);
      if (view.status === 'ACTIVE' && view.readiness !== 'READY') {
        throw new ProfileError('PROFILE_NOT_READY', `Channel profile is not ready: ${view.readinessIssues.join(', ')}`);
      }
      return view;
    });
  }

  archiveChannel(id: string, expectedVersion: number): Promise<ChannelProfileView> {
    return this.write(async (tx) => {
      const current = await tx.channelProfile.findUnique({ where: { id } });
      if (!current) notFound();
      if (current.version !== expectedVersion) conflict();
      const children = await tx.seriesProfile.count({ where: { channelProfileId: id, status: { not: 'ARCHIVED' } } });
      if (children > 0) throw new ProfileError('PROFILE_HAS_ACTIVE_SERIES', 'Archive all series profiles before archiving the channel');
      await checkedChannelStatus(tx, id, expectedVersion, 'ARCHIVED');
      return toChannelView(await tx.channelProfile.findUniqueOrThrow({ where: { id }, include: channelInclude }));
    });
  }

  restoreChannel(id: string, expectedVersion: number): Promise<ChannelProfileView> {
    return this.write(async (tx) => {
      const current = await tx.channelProfile.findUnique({ where: { id } });
      if (!current) notFound();
      if (current.version !== expectedVersion) conflict();
      await checkedChannelStatus(tx, id, expectedVersion, 'DRAFT');
      return toChannelView(await tx.channelProfile.findUniqueOrThrow({ where: { id }, include: channelInclude }));
    });
  }

  async listSeries(query: ProfileListQuery): Promise<ProfileList<SeriesProfileView>> {
    let after = query.cursor ? decodeCursor(query.cursor) : undefined;
    const selected: SeriesProfileView[] = [];
    while (selected.length <= query.limit) {
      const rows = await this.prisma.seriesProfile.findMany({
        where: {
          ...(query.status ? { status: query.status } : { status: { not: 'ARCHIVED' } }),
          ...(query.channelProfileId ? { channelProfileId: query.channelProfileId } : {}),
          ...(query.query ? { name: { contains: query.query, mode: 'insensitive' } } : {}),
          ...(after ? { id: { gt: after } } : {}),
        }, include: seriesInclude, orderBy: { id: 'asc' }, take: query.limit + 1,
      });
      selected.push(...rows.map(toSeriesView)
        .filter((item) => !query.readiness || item.readiness === query.readiness));
      if (rows.length < query.limit + 1 || rows.length === 0) break;
      after = rows.at(-1)!.id;
    }
    return page(selected, query.limit);
  }

  async getSeries(id: string): Promise<SeriesProfileView> {
    const row = await this.prisma.seriesProfile.findUnique({ where: { id }, include: seriesInclude });
    if (!row) notFound();
    return toSeriesView(row);
  }

  createSeries(input: CreateSeriesProfile, idempotencyKey: string, requestHash: string): Promise<SeriesProfileView> {
    return this.idempotent('CREATE_SERIES_PROFILE', idempotencyKey, requestHash, async (tx) => {
      const parent = await tx.channelProfile.findUnique({ where: { id: input.channelProfileId } });
      if (!parent) notFound();
      if (parent.status === 'ARCHIVED') throw new ProfileError('PROFILE_PARENT_ARCHIVED', 'Cannot create a series under an archived channel');
      const row = await tx.seriesProfile.create({
        data: {
          id: uuidV7(), channelProfileId: input.channelProfileId,
          name: input.name.trim(), normalizedName: normalize(input.name),
          ...seriesOverrideData(input.overrides), ...maskData(input.mask),
        }, include: seriesInclude,
      });
      return toSeriesView(row);
    });
  }

  updateSeries(id: string, expectedVersion: number, expectedParentVersion: number, input: UpdateSeriesProfile): Promise<SeriesProfileView> {
    return this.write(async (tx) => {
      const current = await tx.seriesProfile.findUnique({ where: { id }, include: { channelProfile: true } });
      if (!current) notFound();
      if (current.status === 'ARCHIVED') throw new ProfileError('PROFILE_ARCHIVED', 'Archived profile must be restored before editing');
      if (current.version !== expectedVersion || current.channelProfile.version !== expectedParentVersion) conflict();
      if (current.channelProfile.status === 'ARCHIVED') throw new ProfileError('PROFILE_PARENT_ARCHIVED', 'Parent channel is archived');
      const write = await tx.seriesProfile.updateMany({
        where: { id, version: expectedVersion },
        data: {
          version: { increment: 1 },
          ...(input.name !== undefined ? { name: input.name.trim(), normalizedName: normalize(input.name) } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...seriesOverrideData(input.overrides), ...maskData(input.mask),
        },
      });
      if (write.count !== 1) conflict();
      const view = toSeriesView(await tx.seriesProfile.findUniqueOrThrow({ where: { id }, include: seriesInclude }));
      if (view.status === 'ACTIVE' && view.readiness !== 'READY') {
        throw new ProfileError('PROFILE_NOT_READY', `Series profile is not ready: ${view.readinessIssues.join(', ')}`);
      }
      return view;
    });
  }

  archiveSeries(id: string, version: number, parentVersion: number): Promise<SeriesProfileView> {
    return this.changeSeriesStatus(id, version, parentVersion, 'ARCHIVED');
  }

  restoreSeries(id: string, version: number, parentVersion: number): Promise<SeriesProfileView> {
    return this.changeSeriesStatus(id, version, parentVersion, 'DRAFT');
  }

  snapshotForJob(input: { channelProfileId: string; seriesProfileId?: string }): Promise<ProfileJobSnapshot> {
    return this.prisma.$transaction(async (tx) => {
      const settings = await tx.systemSetting.findUniqueOrThrow({ where: { singletonKey: 'DEFAULT' } });
      if (input.seriesProfileId) {
        const row = await tx.seriesProfile.findUnique({ where: { id: input.seriesProfileId }, include: seriesInclude });
        if (!row || row.channelProfileId !== input.channelProfileId) notFound();
        ensureJobReady(toSeriesView(row));
        return jobSnapshot(row.channelProfile, row, settings);
      }
      const row = await tx.channelProfile.findUnique({ where: { id: input.channelProfileId }, include: channelInclude });
      if (!row) notFound();
      ensureJobReady(toChannelView(row));
      return jobSnapshot(row, null, settings);
    }, { isolationLevel: 'RepeatableRead' });
  }

  private changeSeriesStatus(id: string, version: number, parentVersion: number, status: 'DRAFT' | 'ARCHIVED') {
    return this.write(async (tx) => {
      const current = await tx.seriesProfile.findUnique({ where: { id }, include: { channelProfile: true } });
      if (!current) notFound();
      if (current.version !== version || current.channelProfile.version !== parentVersion) conflict();
      if (status === 'DRAFT' && current.channelProfile.status === 'ARCHIVED') throw new ProfileError('PROFILE_PARENT_ARCHIVED', 'Restore the parent channel first');
      const write = await tx.seriesProfile.updateMany({ where: { id, version }, data: { status, version: { increment: 1 } } });
      if (write.count !== 1) conflict();
      return toSeriesView(await tx.seriesProfile.findUniqueOrThrow({ where: { id }, include: seriesInclude }));
    });
  }

  private async idempotent<T extends ChannelProfileView | SeriesProfileView>(
    scope: string, key: string, requestHash: string, action: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.write(async (tx) => {
        const previous = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
        if (previous) {
          if (previous.requestHash !== requestHash) throw new ProfileError('PROFILE_VALIDATION_FAILED', 'Idempotency key was used for a different request');
          return previous.responseBody as unknown as T;
        }
        const result = await action(tx);
        await tx.idempotencyRecord.create({ data: {
          id: uuidV7(), scope, key, requestHash,
          responseBody: result as unknown as Prisma.InputJsonValue,
          responseEtag: profileEtag(result),
        } });
        return result;
      });
    } catch (error) {
      const winner = await this.prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
      if (winner?.requestHash === requestHash) return winner.responseBody as unknown as T;
      throw error;
    }
  }

  private async write<T>(action: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(action);
    } catch (error) {
      if (isPrismaError(error, 'P2002')) throw new ProfileError('PROFILE_NAME_CONFLICT', 'A profile or destination with this identity already exists');
      throw error;
    }
  }
}

function channelPipelineData(input: PipelineConfig) {
  return {
    targetLanguage: input.targetLanguage, defaultVoiceProfileId: input.defaultVoiceProfileId,
    defaultVoiceMode: input.voiceMode, subtitleLanguage: input.subtitleLanguage,
    subtitleFilenameRule: input.subtitleFilenameRule, subtitleMaxLineLength: input.subtitleMaxLineLength,
    ttsSpeed: input.ttsSpeed, timingPolicy: input.timingPolicy,
    output16x9Enabled: input.output16x9Enabled, output9x16Enabled: input.output9x16Enabled,
  };
}

function channelPipelinePatch(input: Partial<PipelineConfig> | undefined): Prisma.ChannelProfileUncheckedUpdateInput {
  if (!input) return {};
  return {
    ...(input.targetLanguage !== undefined ? { targetLanguage: input.targetLanguage } : {}),
    ...(input.defaultVoiceProfileId !== undefined ? { defaultVoiceProfileId: input.defaultVoiceProfileId } : {}),
    ...(input.voiceMode !== undefined ? { defaultVoiceMode: input.voiceMode } : {}),
    ...(input.subtitleLanguage !== undefined ? { subtitleLanguage: input.subtitleLanguage } : {}),
    ...(input.subtitleFilenameRule !== undefined ? { subtitleFilenameRule: input.subtitleFilenameRule } : {}),
    ...(input.subtitleMaxLineLength !== undefined ? { subtitleMaxLineLength: input.subtitleMaxLineLength } : {}),
    ...(input.ttsSpeed !== undefined ? { ttsSpeed: input.ttsSpeed } : {}),
    ...(input.timingPolicy !== undefined ? { timingPolicy: input.timingPolicy } : {}),
    ...(input.output16x9Enabled !== undefined ? { output16x9Enabled: input.output16x9Enabled } : {}),
    ...(input.output9x16Enabled !== undefined ? { output9x16Enabled: input.output9x16Enabled } : {}),
  };
}

function channelContentData(input: CreateChannelProfile['content']) {
  return {
    contentVoiceRules: input.voiceRules as Prisma.InputJsonValue,
    contentCtaTemplate: input.ctaTemplate,
    contentMetadataTemplate: input.metadataTemplate as Prisma.InputJsonValue,
    contentBaseKeywords: input.baseKeywords,
  };
}

function channelContentPatch(input: UpdateChannelProfile['content']): Prisma.ChannelProfileUncheckedUpdateInput {
  if (!input) return {};
  return {
    ...(input.voiceRules !== undefined ? { contentVoiceRules: input.voiceRules as Prisma.InputJsonValue } : {}),
    ...(input.ctaTemplate !== undefined ? { contentCtaTemplate: input.ctaTemplate } : {}),
    ...(input.metadataTemplate !== undefined ? { contentMetadataTemplate: input.metadataTemplate as Prisma.InputJsonValue } : {}),
    ...(input.baseKeywords !== undefined ? { contentBaseKeywords: input.baseKeywords } : {}),
  };
}

function destinationCreate(input: DestinationInput) {
  return {
    id: uuidV7(), platform: input.platform, externalId: input.externalId ?? null,
    displayName: input.displayName.trim(), normalizedName: normalize(input.displayName),
    isRequired: input.isRequired, isActive: input.isActive,
    platformConfig: input.platformConfig as Prisma.InputJsonValue,
  };
}

function seriesOverrideData(input: Partial<SeriesOverrides> | undefined) {
  if (!input) return {};
  return {
    ...(input.targetLanguage !== undefined ? { targetLanguageOverride: input.targetLanguage } : {}),
    ...(input.defaultVoiceProfileId !== undefined ? { defaultVoiceProfileOverrideId: input.defaultVoiceProfileId } : {}),
    ...(input.voiceMode !== undefined ? { voiceModeOverride: input.voiceMode } : {}),
    ...(input.subtitleLanguage !== undefined ? { subtitleLanguageOverride: input.subtitleLanguage } : {}),
    ...(input.subtitleFilenameRule !== undefined ? { subtitleFilenameRuleOverride: input.subtitleFilenameRule } : {}),
    ...(input.subtitleMaxLineLength !== undefined ? { subtitleMaxLineLengthOverride: input.subtitleMaxLineLength } : {}),
    ...(input.ttsSpeed !== undefined ? { ttsSpeedOverride: input.ttsSpeed } : {}),
    ...(input.timingPolicy !== undefined ? { timingPolicyOverride: input.timingPolicy } : {}),
    ...(input.output16x9Enabled !== undefined ? { output16x9Override: input.output16x9Enabled } : {}),
    ...(input.output9x16Enabled !== undefined ? { output9x16Override: input.output9x16Enabled } : {}),
  };
}

function maskData(mask: CreateSeriesProfile['mask'] | undefined) {
  if (mask === undefined) return {};
  return mask === null
    ? { maskX: null, maskY: null, maskWidth: null, maskHeight: null }
    : { maskX: mask.x, maskY: mask.y, maskWidth: mask.width, maskHeight: mask.height };
}

function toChannelView(row: ChannelRow): ChannelProfileView {
  const issues: string[] = [];
  if (!row.output16x9Enabled && !row.output9x16Enabled) issues.push('OUTPUT_REQUIRED');
  if (!row.defaultVoiceProfileId) issues.push('DEFAULT_VOICE_REQUIRED');
  else if (row.defaultVoice?.status !== 'READY') issues.push('DEFAULT_VOICE_NOT_READY');
  return {
    id: row.id, name: row.name, status: row.status,
    pipeline: channelPipeline(row),
    content: {
      voiceRules: asObject(row.contentVoiceRules), ctaTemplate: row.contentCtaTemplate,
      metadataTemplate: asObject(row.contentMetadataTemplate), baseKeywords: row.contentBaseKeywords,
    },
    destinations: row.destinations.map((item) => ({
      id: item.id, platform: item.platform, externalId: item.externalId,
      displayName: item.displayName, isRequired: item.isRequired, isActive: item.isActive,
      platformConfig: asObject(item.platformConfig), version: item.version,
    })),
    assets: row.assets.map(assetView), readiness: issues.length ? 'NEEDS_CONFIGURATION' : 'READY',
    readinessIssues: issues, version: row.version,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

function toSeriesView(row: SeriesRow): SeriesProfileView {
  const parent = toChannelView(row.channelProfile);
  const overrides: SeriesOverrides = {
    targetLanguage: row.targetLanguageOverride,
    defaultVoiceProfileId: row.defaultVoiceProfileOverrideId,
    voiceMode: row.voiceModeOverride,
    subtitleLanguage: row.subtitleLanguageOverride,
    subtitleFilenameRule: row.subtitleFilenameRuleOverride,
    subtitleMaxLineLength: row.subtitleMaxLineLengthOverride,
    ttsSpeed: decimal(row.ttsSpeedOverride), timingPolicy: row.timingPolicyOverride,
    output16x9Enabled: row.output16x9Override, output9x16Enabled: row.output9x16Override,
  };
  const effectiveConfig = mergePipeline(parent.pipeline, overrides);
  const issues = [...parent.readinessIssues];
  if (row.defaultVoiceProfileOverrideId) {
    remove(issues, 'DEFAULT_VOICE_REQUIRED');
    remove(issues, 'DEFAULT_VOICE_NOT_READY');
    if (row.defaultVoiceOverride?.status !== 'READY') issues.push('DEFAULT_VOICE_NOT_READY');
  }
  remove(issues, 'OUTPUT_REQUIRED');
  if (!effectiveConfig.output16x9Enabled && !effectiveConfig.output9x16Enabled) issues.push('OUTPUT_REQUIRED');
  const mask = row.maskX === null ? null : {
    x: decimal(row.maskX)!, y: decimal(row.maskY)!, width: decimal(row.maskWidth)!, height: decimal(row.maskHeight)!,
  };
  const assets = row.assets.map(assetView);
  if (mask && !assets.some((item) => item.role === 'MASK_REFERENCE_FRAME')) issues.push('MASK_REFERENCE_ASSET_REQUIRED');
  if (effectiveConfig.voiceMode !== 'SINGLE') issues.push('CAST_REQUIRED');
  if (row.channelProfile.status !== 'ACTIVE') issues.push('PARENT_CHANNEL_NOT_ACTIVE');
  const uniqueIssues = [...new Set(issues)];
  return {
    id: row.id, channelProfileId: row.channelProfileId, name: row.name, status: row.status,
    overrides, effectiveConfig, inheritance: inheritance(overrides), mask, assets,
    readiness: uniqueIssues.length ? 'NEEDS_CONFIGURATION' : 'READY', readinessIssues: uniqueIssues,
    version: row.version, parentVersion: row.channelProfile.version,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

function channelPipeline(row: ChannelRow): PipelineConfig {
  return {
    targetLanguage: row.targetLanguage, defaultVoiceProfileId: row.defaultVoiceProfileId,
    voiceMode: row.defaultVoiceMode, subtitleLanguage: row.subtitleLanguage,
    subtitleFilenameRule: row.subtitleFilenameRule, subtitleMaxLineLength: row.subtitleMaxLineLength,
    ttsSpeed: decimal(row.ttsSpeed)!, timingPolicy: row.timingPolicy,
    output16x9Enabled: row.output16x9Enabled, output9x16Enabled: row.output9x16Enabled,
  };
}

function mergePipeline(parent: PipelineConfig, overrides: SeriesOverrides): PipelineConfig {
  return Object.fromEntries(Object.entries(parent).map(([key, value]) => [
    key, overrides[key as keyof SeriesOverrides] ?? value,
  ])) as PipelineConfig;
}

function inheritance(overrides: SeriesOverrides): SeriesProfileView['inheritance'] {
  return Object.fromEntries(Object.keys(overrides).map((key) => [
    key, overrides[key as keyof SeriesOverrides] === null ? 'CHANNEL' : 'SERIES',
  ])) as SeriesProfileView['inheritance'];
}

function assetView(link: ChannelRow['assets'][number] | SeriesRow['assets'][number]) {
  return {
    linkId: link.id, assetId: link.assetId, role: link.role,
    fileName: link.asset.fileName, contentType: link.asset.contentType,
    byteSize: link.asset.byteSize?.toString() ?? null, width: link.asset.width,
    height: link.asset.height, revision: link.revision,
  };
}

function jobSnapshot(
  channel: ChannelRow,
  series: SeriesRow | null,
  settings: { version: number; rawVideoDays: number; intermediateDays: number; taskLogDays: number; finalOutputDays: number },
): ProfileJobSnapshot {
  const channelView = toChannelView(channel);
  const seriesView = series ? toSeriesView(series) : null;
  const voice = series?.defaultVoiceOverride ?? channel.defaultVoice;
  if (!voice) throw new ProfileError('PROFILE_NOT_READY', 'Profile has no default voice to snapshot');
  return {
    schemaVersion: 1,
    profile: {
      channelProfileId: channel.id, channelProfileVersion: channel.version,
      seriesProfileId: series?.id ?? null, seriesProfileVersion: series?.version ?? null,
    },
    pipeline: seriesView?.effectiveConfig ?? channelView.pipeline,
    content: channelView.content,
    mask: seriesView?.mask ?? null,
    assets: [...channel.assets, ...(series?.assets ?? [])].map(assetSnapshot),
    destinations: channelView.destinations,
    defaultVoice: { profileId: voice.id, version: voice.version },
    retention: {
      settingsVersion: settings.version, rawVideoDays: settings.rawVideoDays,
      intermediateDays: settings.intermediateDays, taskLogDays: settings.taskLogDays,
      finalOutputDays: settings.finalOutputDays,
    },
  };
}

function assetSnapshot(link: ChannelRow['assets'][number] | SeriesRow['assets'][number]) {
  return {
    ...assetView(link), assetVersion: link.asset.version, storageBackend: link.asset.storageBackend,
    bucket: link.asset.bucket, objectKey: link.asset.objectKey, checksumSha256: link.asset.checksumSha256,
  };
}

function ensureJobReady(profile: ChannelProfileView | SeriesProfileView): void {
  if (profile.status !== 'ACTIVE') throw new ProfileError('PROFILE_NOT_READY', 'Only an active profile can create a job snapshot');
  if (profile.readiness !== 'READY') {
    throw new ProfileError('PROFILE_NOT_READY', `Profile is not ready: ${profile.readinessIssues.join(', ')}`);
  }
}

function page<T extends { id: string }>(items: T[], limit: number): ProfileList<T> {
  const hasNext = items.length > limit;
  const selected = items.slice(0, limit);
  return { items: selected, nextCursor: hasNext ? encodeCursor(selected.at(-1)!.id) : null };
}

function encodeCursor(id: string): string { return Buffer.from(id).toString('base64url'); }
function decodeCursor(cursor: string): string {
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) {
    throw new ProfileError('PROFILE_VALIDATION_FAILED', 'Invalid pagination cursor');
  }
  return id;
}
function normalize(value: string): string { return value.trim().normalize('NFKC').toLocaleLowerCase('en-US'); }
function decimal(value: { toNumber(): number } | null): number | null { return value?.toNumber() ?? null; }
function asObject(value: Prisma.JsonValue): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function remove(values: string[], value: string): void { const index = values.indexOf(value); if (index >= 0) values.splice(index, 1); }
function profileEtag(value: ChannelProfileView | SeriesProfileView): string {
  return 'parentVersion' in value ? `"${value.version}:${value.parentVersion}"` : `"${value.version}"`;
}
function notFound(): never { throw new ProfileError('PROFILE_NOT_FOUND', 'Profile was not found'); }
function conflict(): never { throw new ProfileError('PROFILE_VERSION_CONFLICT', 'Profile changed since it was loaded'); }
function isPrismaError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === code;
}
async function checkedChannelStatus(tx: Tx, id: string, version: number, status: 'DRAFT' | 'ARCHIVED'): Promise<void> {
  const write = await tx.channelProfile.updateMany({ where: { id, version }, data: { status, version: { increment: 1 } } });
  if (write.count !== 1) conflict();
}
