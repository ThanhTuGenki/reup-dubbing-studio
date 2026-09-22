import { createHash } from 'node:crypto';

import type { Prisma, PrismaClient, ReviewGateMode, ReviewPolicy as ReviewPolicyRow } from '@prisma/client';
import type { ReviewPolicyInheritance, ReviewPolicyValues, StoredReviewPolicyValues } from '@reup-dubbing-studio/api-contract';

import { uuidV7 } from '../../../platform/ids/uuid-v7';
import { ReviewPolicyError } from '../domain/review-policy-errors';
import type {
  ChannelReviewPolicyPatch,
  ReviewPolicySnapshot,
  ReviewPolicyView,
  SeriesReviewPolicyPatch,
} from '../domain/review-policy';

type Tx = Prisma.TransactionClient;
type PolicyPatch = ChannelReviewPolicyPatch | SeriesReviewPolicyPatch;
const CHANNEL_SCOPE = 'UPDATE_CHANNEL_REVIEW_POLICY_V1';
const SERIES_SCOPE = 'UPDATE_SERIES_REVIEW_POLICY_V1';

export class PrismaReviewPolicyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  getChannel(channelProfileId: string): Promise<ReviewPolicyView> {
    return this.prisma.$transaction(async (tx) => {
      const channel = await tx.channelProfile.findUnique({ where: { id: channelProfileId }, select: { id: true, defaultVoiceMode: true } });
      if (!channel) notFound();
      const policy = await ensureChannelPolicy(tx, channel.id, channel.defaultVoiceMode);
      return channelView(channel.id, policy);
    });
  }

  getSeries(seriesProfileId: string): Promise<ReviewPolicyView> {
    return this.prisma.$transaction(async (tx) => seriesViewFor(tx, seriesProfileId));
  }

  updateChannel(
    channelProfileId: string,
    expectedVersion: number,
    input: ChannelReviewPolicyPatch,
    idempotencyKey: string,
  ): Promise<ReviewPolicyView> {
    validatePatch(input, false);
    return this.idempotent(CHANNEL_SCOPE, idempotencyKey, { channelProfileId, expectedVersion, input }, async (tx) => {
      const channel = await tx.channelProfile.findUnique({ where: { id: channelProfileId }, select: { id: true, defaultVoiceMode: true } });
      if (!channel) notFound();
      const current = await ensureChannelPolicy(tx, channel.id, channel.defaultVoiceMode);
      if (current.version !== expectedVersion) conflict();
      const changed = await tx.reviewPolicy.updateMany({
        where: { id: current.id, version: expectedVersion },
        data: { ...patchData(input), version: { increment: 1 } },
      });
      if (changed.count !== 1) conflict();
      return channelView(channel.id, await tx.reviewPolicy.findUniqueOrThrow({ where: { id: current.id } }));
    });
  }

  updateSeries(
    seriesProfileId: string,
    expectedVersion: number,
    expectedParentVersion: number,
    input: SeriesReviewPolicyPatch,
    idempotencyKey: string,
  ): Promise<ReviewPolicyView> {
    validatePatch(input, true);
    return this.idempotent(SERIES_SCOPE, idempotencyKey, { seriesProfileId, expectedVersion, expectedParentVersion, input }, async (tx) => {
      const series = await tx.seriesProfile.findUnique({
        where: { id: seriesProfileId },
        select: { id: true, channelProfile: { select: { id: true, defaultVoiceMode: true } } },
      });
      if (!series) notFound();
      const parent = await ensureChannelPolicy(tx, series.channelProfile.id, series.channelProfile.defaultVoiceMode);
      const current = await ensureSeriesPolicy(tx, series.id);
      if (current.version !== expectedVersion || parent.version !== expectedParentVersion) conflict();
      const changed = await tx.reviewPolicy.updateMany({
        where: { id: current.id, version: expectedVersion },
        data: { ...patchData(input), version: { increment: 1 } },
      });
      if (changed.count !== 1) conflict();
      const updated = await tx.reviewPolicy.findUniqueOrThrow({ where: { id: current.id } });
      return seriesView(series.id, updated, parent);
    });
  }

  private async idempotent(
    scope: string,
    key: string,
    request: object,
    action: (tx: Tx) => Promise<ReviewPolicyView>,
  ): Promise<ReviewPolicyView> {
    const keyHash = hash(key);
    const requestHash = hash(stableJson(request));
    try {
      return await this.prisma.$transaction(async (tx) => {
        const previous = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key: keyHash } } });
        if (previous) return replay(previous.requestHash, requestHash, previous.responseBody);
        const result = await action(tx);
        await tx.idempotencyRecord.create({ data: {
          id: uuidV7(), scope, key: keyHash, requestHash,
          responseBody: result as unknown as Prisma.InputJsonValue,
          responseEtag: policyEtag(result),
        } });
        return result;
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      const winner = await this.prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope, key: keyHash } } });
      if (winner) return replay(winner.requestHash, requestHash, winner.responseBody);
      throw error;
    }
  }
}

export async function resolveReviewPolicySnapshot(
  tx: Tx,
  input: { channelProfileId: string; seriesProfileId?: string | null },
): Promise<ReviewPolicySnapshot> {
  const channel = await tx.channelProfile.findUnique({
    where: { id: input.channelProfileId },
    select: { id: true, defaultVoiceMode: true },
  });
  if (!channel) notFound();
  const parent = await ensureChannelPolicy(tx, channel.id, channel.defaultVoiceMode);
  if (!input.seriesProfileId) {
    return { schemaVersion: 1, channelPolicyVersion: parent.version, seriesPolicyVersion: null, effective: requiredValues(parent) };
  }
  const series = await tx.seriesProfile.findUnique({ where: { id: input.seriesProfileId }, select: { channelProfileId: true } });
  if (!series || series.channelProfileId !== channel.id) notFound();
  const child = await ensureSeriesPolicy(tx, input.seriesProfileId);
  return {
    schemaVersion: 1,
    channelPolicyVersion: parent.version,
    seriesPolicyVersion: child.version,
    effective: effectiveValues(child, parent),
  };
}

async function seriesViewFor(tx: Tx, seriesProfileId: string): Promise<ReviewPolicyView> {
  const series = await tx.seriesProfile.findUnique({
    where: { id: seriesProfileId },
    select: { id: true, channelProfile: { select: { id: true, defaultVoiceMode: true } } },
  });
  if (!series) notFound();
  const parent = await ensureChannelPolicy(tx, series.channelProfile.id, series.channelProfile.defaultVoiceMode);
  const child = await ensureSeriesPolicy(tx, series.id);
  return seriesView(series.id, child, parent);
}

async function ensureChannelPolicy(tx: Tx, channelProfileId: string, voiceMode: string): Promise<ReviewPolicyRow> {
  const existing = await tx.reviewPolicy.findUnique({ where: { channelProfileId } });
  if (existing) return existing;
  return tx.reviewPolicy.create({ data: {
    id: uuidV7(), channelProfileId,
    castGate: voiceMode === 'MULTI_AUTO' ? 'MANUAL_REQUIRED' : 'NOT_REQUIRED',
    scriptGate: 'MANUAL_REQUIRED', ttsGate: 'MANUAL_REQUIRED', renderGate: 'MANUAL_REQUIRED',
    publishContentGate: 'MANUAL_REQUIRED', autoRequestRender: false,
  } });
}

async function ensureSeriesPolicy(tx: Tx, seriesProfileId: string): Promise<ReviewPolicyRow> {
  const existing = await tx.reviewPolicy.findUnique({ where: { seriesProfileId } });
  return existing ?? tx.reviewPolicy.create({ data: { id: uuidV7(), seriesProfileId } });
}

function channelView(channelProfileId: string, row: ReviewPolicyRow): ReviewPolicyView {
  return {
    ownerType: 'CHANNEL', ownerProfileId: channelProfileId,
    stored: storedValues(row), effective: requiredValues(row),
    inheritance: allSources('CHANNEL'), version: row.version, parentPolicyVersion: null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function seriesView(seriesProfileId: string, row: ReviewPolicyRow, parent: ReviewPolicyRow): ReviewPolicyView {
  return {
    ownerType: 'SERIES', ownerProfileId: seriesProfileId,
    stored: storedValues(row), effective: effectiveValues(row, parent),
    inheritance: inheritance(row), version: row.version, parentPolicyVersion: parent.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function storedValues(row: ReviewPolicyRow): StoredReviewPolicyValues {
  return {
    castGate: row.castGate, scriptGate: row.scriptGate, ttsGate: row.ttsGate,
    renderGate: row.renderGate, publishContentGate: row.publishContentGate,
    autoRequestRender: row.autoRequestRender,
  };
}

function requiredValues(row: ReviewPolicyRow): ReviewPolicyValues {
  if (!row.castGate || !row.scriptGate || !row.ttsGate || !row.renderGate
    || !row.publishContentGate || row.autoRequestRender === null) {
    throw new ReviewPolicyError('REVIEW_POLICY_VALIDATION_FAILED', 'Channel review policy is incomplete');
  }
  return {
    castGate: row.castGate, scriptGate: row.scriptGate, ttsGate: row.ttsGate,
    renderGate: row.renderGate, publishContentGate: row.publishContentGate,
    autoRequestRender: row.autoRequestRender,
  };
}

function effectiveValues(child: ReviewPolicyRow, parent: ReviewPolicyRow): ReviewPolicyValues {
  const base = requiredValues(parent);
  return {
    castGate: child.castGate ?? base.castGate,
    scriptGate: child.scriptGate ?? base.scriptGate,
    ttsGate: child.ttsGate ?? base.ttsGate,
    renderGate: child.renderGate ?? base.renderGate,
    publishContentGate: child.publishContentGate ?? base.publishContentGate,
    autoRequestRender: child.autoRequestRender ?? base.autoRequestRender,
  };
}

function inheritance(row: ReviewPolicyRow): ReviewPolicyInheritance {
  return {
    castGate: source(row.castGate), scriptGate: source(row.scriptGate), ttsGate: source(row.ttsGate),
    renderGate: source(row.renderGate), publishContentGate: source(row.publishContentGate),
    autoRequestRender: source(row.autoRequestRender),
  };
}

function allSources(value: 'CHANNEL' | 'SERIES'): ReviewPolicyInheritance {
  return { castGate: value, scriptGate: value, ttsGate: value, renderGate: value, publishContentGate: value, autoRequestRender: value };
}

function source(value: ReviewGateMode | boolean | null): 'CHANNEL' | 'SERIES' { return value === null ? 'CHANNEL' : 'SERIES'; }

function patchData(input: PolicyPatch): Prisma.ReviewPolicyUpdateManyMutationInput {
  return {
    ...(input.castGate !== undefined ? { castGate: input.castGate } : {}),
    ...(input.scriptGate !== undefined ? { scriptGate: input.scriptGate } : {}),
    ...(input.ttsGate !== undefined ? { ttsGate: input.ttsGate } : {}),
    ...(input.renderGate !== undefined ? { renderGate: input.renderGate } : {}),
    ...(input.publishContentGate !== undefined ? { publishContentGate: input.publishContentGate } : {}),
    ...(input.autoRequestRender !== undefined ? { autoRequestRender: input.autoRequestRender } : {}),
  };
}

function validatePatch(input: PolicyPatch, nullable: boolean): void {
  if (Object.keys(input).length === 0) throw new ReviewPolicyError('REVIEW_POLICY_VALIDATION_FAILED', 'Review policy patch must change at least one field');
  if (!nullable && Object.values(input).some((value) => value === null)) {
    throw new ReviewPolicyError('REVIEW_POLICY_VALIDATION_FAILED', 'Channel review policy fields cannot be null');
  }
}

function replay(previousHash: string, requestHash: string, body: Prisma.JsonValue): ReviewPolicyView {
  if (previousHash !== requestHash) throw new ReviewPolicyError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was used for another request');
  return body as unknown as ReviewPolicyView;
}

function policyEtag(value: ReviewPolicyView): string {
  return value.parentPolicyVersion === null ? `"${value.version}"` : `"${value.version}:${value.parentPolicyVersion}"`;
}
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
function notFound(): never { throw new ReviewPolicyError('REVIEW_POLICY_NOT_FOUND', 'Review policy owner was not found'); }
function conflict(): never { throw new ReviewPolicyError('VERSION_CONFLICT', 'Review policy version is stale'); }
