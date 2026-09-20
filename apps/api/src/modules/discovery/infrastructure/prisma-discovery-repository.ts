import { Prisma, type PrismaClient } from '@prisma/client';
import { uuidV7 } from '../../../platform/ids/uuid-v7';
import type { CreateRun, CreateSourceAccount, CreateWatchlist, DiscoveryItemQuery, UpdateWatchlist } from '../domain/discovery';
import { DiscoveryError } from '../domain/discovery-errors';
import type { NormalizedContent } from '../domain/discovery';
import { sanitizeProviderUrl } from './url-sanitizer';

const accountInclude = { credentials: { where: { revokedAt: null }, select: { kind: true, encryptedAt: true, expiresAt: true }, take: 1 } } satisfies Prisma.SourceAccountInclude;

export class PrismaDiscoveryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createAccount(input: CreateSourceAccount, key: string, requestHash: string) {
    return this.idempotent('CREATE_SOURCE_ACCOUNT', key, requestHash, async (tx) => accountView(await tx.sourceAccount.create({ data: { id: uuidV7(), platform: input.platform, displayName: input.displayName.trim() }, include: accountInclude })));
  }
  async listAccounts(platform?: 'DOUYIN' | 'BILIBILI' | 'YOUTUBE') {
    const rows = await this.prisma.sourceAccount.findMany({ where: platform ? { platform } : {}, include: accountInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return { items: rows.map(accountView) };
  }
  async account(id: string) {
    const row = await this.prisma.sourceAccount.findUnique({ where: { id }, include: accountInclude });
    if (!row) notFound('SOURCE_ACCOUNT_NOT_FOUND', 'Source account was not found');
    return accountView(row);
  }
  async storeCredential(accountId: string, ciphertext: Buffer, expiresAt: Date | null) {
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.sourceAccount.findUnique({ where: { id: accountId } });
      if (!account) notFound('SOURCE_ACCOUNT_NOT_FOUND', 'Source account was not found');
      const now = new Date();
      await tx.sourceCredential.updateMany({ where: { sourceAccountId: accountId, kind: 'NETSCAPE_COOKIE', revokedAt: null }, data: { revokedAt: now } });
      await tx.sourceCredential.create({ data: { id: uuidV7(), sourceAccountId: accountId, kind: 'NETSCAPE_COOKIE', ciphertext: new Uint8Array(ciphertext), encryptionKeyId: 'source-v1', encryptedAt: now, expiresAt } });
      return accountView(await tx.sourceAccount.update({ where: { id: accountId }, data: { status: expiresAt && expiresAt <= now ? 'EXPIRED' : 'ACTIVE', consecutiveFailures: 0, cooldownUntil: null, version: { increment: 1 } }, include: accountInclude }));
    });
  }
  async activeCredential(accountId: string) {
    const row = await this.prisma.sourceCredential.findFirst({ where: { sourceAccountId: accountId, kind: 'NETSCAPE_COOKIE', revokedAt: null }, orderBy: { encryptedAt: 'desc' } });
    if (!row) throw new DiscoveryError('SOURCE_ACCOUNT_CREDENTIAL_REQUIRED', 'Source account needs a current credential');
    return row;
  }
  async revokeCredential(accountId: string) {
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.sourceAccount.findUnique({ where: { id: accountId } });
      if (!account) notFound('SOURCE_ACCOUNT_NOT_FOUND', 'Source account was not found');
      await tx.sourceCredential.updateMany({ where: { sourceAccountId: accountId, kind: 'NETSCAPE_COOKIE', revokedAt: null }, data: { revokedAt: new Date() } });
      return accountView(await tx.sourceAccount.update({ where: { id: accountId }, data: { status: 'REVOKED', version: { increment: 1 } }, include: accountInclude }));
    });
  }
  async recordValidation(accountId: string, status: 'ACTIVE' | 'EXPIRED' | 'CAPTCHA_REQUIRED' | 'INVALID') {
    const now = new Date();
    const row = await this.prisma.sourceAccount.update({ where: { id: accountId }, data: { status, lastValidatedAt: now, ...(status === 'ACTIVE' ? { lastSuccessAt: now, consecutiveFailures: 0, cooldownUntil: null } : { consecutiveFailures: { increment: 1 } }), version: { increment: 1 } }, include: accountInclude }).catch(() => null);
    if (!row) notFound('SOURCE_ACCOUNT_NOT_FOUND', 'Source account was not found');
    return accountView(row);
  }
  async listCategories(platform: 'DOUYIN' | 'BILIBILI' | 'YOUTUBE') {
    const rows = await this.prisma.sourceCategory.findMany({ where: { platform, isActive: true }, orderBy: [{ kind: 'asc' }, { label: 'asc' }] });
    return { items: rows.map((row) => ({ id: row.id, platform: row.platform, externalKey: row.externalKey, slug: row.slug, label: row.label, kind: row.kind, parentId: row.parentId })) };
  }
  async createRun(input: CreateRun, key: string, requestHash: string, watchlistId?: string) {
    return this.idempotent('CREATE_DISCOVERY_RUN', key, requestHash, async (tx) => {
      const account = await tx.sourceAccount.findUnique({ where: { id: input.sourceAccountId } });
      if (!account) notFound('SOURCE_ACCOUNT_NOT_FOUND', 'Source account was not found');
      if (account.status !== 'ACTIVE') throw new DiscoveryError('SOURCE_ACCOUNT_CREDENTIAL_REQUIRED', 'Source account credential is not active');
      if (input.categoryId && !(await tx.sourceCategory.findFirst({ where: { id: input.categoryId, platform: account.platform, isActive: true } }))) invalid('Category does not belong to this platform');
      return runView(await tx.discoveryRun.create({ data: { id: uuidV7(), sourceAccountId: input.sourceAccountId, mode: input.mode, ...(input.input !== undefined ? { input: input.input } : {}), ...(input.query !== undefined ? { query: input.query } : {}), ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}), ...(watchlistId !== undefined ? { watchlistId } : {}), ...(input.requestedLimit !== undefined ? { requestedLimit: input.requestedLimit } : {}) } }));
    }, watchlistId ? 'WATCHLIST_RUN_ACTIVE' : undefined);
  }
  async run(id: string) { const row = await this.prisma.discoveryRun.findUnique({ where: { id } }); if (!row) notFound('DISCOVERY_RUN_NOT_FOUND', 'Discovery run was not found'); return runView(row); }
  async claimRun(id: string) {
    const claimed = await this.prisma.discoveryRun.updateMany({ where: { id, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date(), version: { increment: 1 } } });
    if (!claimed.count) return null;
    return this.prisma.discoveryRun.findUniqueOrThrow({ where: { id }, include: { sourceAccount: true, category: true } });
  }
  async persistPage(runId: string, platform: 'DOUYIN' | 'BILIBILI' | 'YOUTUBE', pageIndex: number, contents: NormalizedContent[], cursor: unknown, skippedCounts: Record<string, number>) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.discoveryRun.findUniqueOrThrow({ where: { id: runId } });
      if (current.status === 'CANCELLED') return false;
      const observedAt = new Date(); let inserted = 0;
      for (const content of dedupeContents(contents)) {
        let creatorId: string | null = null;
        if (content.creator) {
          const creator = await tx.sourceCreator.upsert({ where: { platform_externalId: { platform, externalId: content.creator.externalId } }, create: { id: uuidV7(), platform, externalId: content.creator.externalId, externalSecureId: content.creator.externalSecureId ?? null, nickname: content.creator.nickname ?? null, avatarUrl: sanitizedPublicUrl(content.creator.avatarUrl), profileUrl: sanitizedPublicUrl(content.creator.profileUrl), availability: 'AVAILABLE', firstSeenAt: observedAt, lastSeenAt: observedAt }, update: { externalSecureId: content.creator.externalSecureId ?? null, nickname: content.creator.nickname ?? null, avatarUrl: sanitizedPublicUrl(content.creator.avatarUrl), profileUrl: sanitizedPublicUrl(content.creator.profileUrl), availability: 'AVAILABLE', lastSeenAt: observedAt } }); creatorId = creator.id;
        }
        const canonical = sanitizedPublicUrl(content.canonicalUrl);
        const source = await tx.sourceContent.upsert({ where: { platform_externalId: { platform, externalId: content.externalId } }, create: { id: uuidV7(), platform, externalId: content.externalId, creatorId, contentType: content.contentType, externalTypeCode: content.externalTypeCode ?? null, title: content.title ?? null, description: content.description ?? null, canonicalUrl: canonical, publishedAt: content.publishedAt ?? null, durationMs: content.durationMs ?? null, width: content.width ?? null, height: content.height ?? null, availability: content.availability, isIngestEligible: content.isIngestEligible, firstSeenAt: observedAt, lastSeenAt: observedAt }, update: { creatorId, contentType: content.contentType, externalTypeCode: content.externalTypeCode ?? null, title: content.title ?? null, description: content.description ?? null, canonicalUrl: canonical, publishedAt: content.publishedAt ?? null, durationMs: content.durationMs ?? null, width: content.width ?? null, height: content.height ?? null, availability: content.availability, isIngestEligible: content.isIngestEligible, lastSeenAt: observedAt, metadataVersion: { increment: 1 } } });
        for (const media of content.media ?? []) { const safe = sanitizeProviderUrl(media.url); await tx.sourceMediaCandidate.upsert({ where: { sourceContentId_role_urlFingerprint: { sourceContentId: source.id, role: media.role, urlFingerprint: safe.urlFingerprint } }, create: { id: uuidV7(), sourceContentId: source.id, role: media.role, canonicalUrl: safe.canonicalUrl, urlFingerprint: safe.urlFingerprint, requiresRefresh: safe.requiresRefresh || media.role.startsWith('PLAYBACK'), codec: media.codec ?? null, container: media.container ?? null, width: media.width ?? null, height: media.height ?? null, observedAt }, update: { canonicalUrl: safe.canonicalUrl, requiresRefresh: safe.requiresRefresh || media.role.startsWith('PLAYBACK'), observedAt } }); }
        if (content.metrics) await tx.contentMetricSnapshot.create({ data: { id: uuidV7(), sourceContentId: source.id, capturedAt: new Date(observedAt.getTime() + inserted), playCount: metric(content.metrics.playCount), diggCount: metric(content.metrics.diggCount), commentCount: metric(content.metrics.commentCount), collectCount: metric(content.metrics.collectCount), shareCount: metric(content.metrics.shareCount), forwardCount: metric(content.metrics.forwardCount) } });
        const result = await tx.discoveryItem.createMany({ data: [{ id: uuidV7(), discoveryRunId: runId, sourceContentId: source.id, rank: current.itemCount + inserted + 1, pageIndex, categoryId: current.categoryId, discoveredAt: observedAt }], skipDuplicates: true });
        inserted += result.count;
      }
      await tx.discoveryRun.update({ where: { id: runId }, data: { providerCursor: cursor === null ? Prisma.JsonNull : cursor as Prisma.InputJsonValue, pageCount: { increment: 1 }, itemCount: { increment: inserted }, skippedCounts: mergeCounts(current.skippedCounts, skippedCounts) } });
      return true;
    });
  }
  async finishRun(id: string, status: 'SUCCEEDED' | 'PARTIAL', errorCode?: string, detail?: string) { await this.prisma.discoveryRun.updateMany({ where: { id, status: 'RUNNING' }, data: { status, ...(errorCode ? { errorCode, errorDetailSafe: detail ?? null } : {}), finishedAt: new Date(), version: { increment: 1 } } }); }
  async failRun(id: string, code: string, detail: string) { await this.prisma.discoveryRun.updateMany({ where: { id, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'FAILED', errorCode: code, errorDetailSafe: detail, finishedAt: new Date(), version: { increment: 1 } } }); }
  async cancelRun(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.discoveryRun.findUnique({ where: { id } });
      if (!row) notFound('DISCOVERY_RUN_NOT_FOUND', 'Discovery run was not found');
      if (['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(row.status)) return runView(row);
      return runView(await tx.discoveryRun.update({ where: { id }, data: { status: 'CANCELLED', finishedAt: new Date(), version: { increment: 1 } } }));
    });
  }
  async listItems(query: DiscoveryItemQuery) {
    const after = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.discoveryItem.findMany({
      where: {
        ...(query.runId ? { discoveryRunId: query.runId } : {}),
        ...(after ? { OR: [{ discoveredAt: { lt: after.discoveredAt } }, { discoveredAt: after.discoveredAt, id: { gt: after.id } }] } : {}),
        sourceContent: {
          ...(query.creatorId ? { creatorId: query.creatorId } : {}), ...(query.contentType ? { contentType: query.contentType } : {}),
          ...(query.availability ? { availability: query.availability } : {}), ...(query.ingestEligible !== undefined ? { isIngestEligible: query.ingestEligible } : {}),
          ...(query.categoryId ? { categoryLinks: { some: { sourceCategoryId: query.categoryId } } } : {}),
        },
      }, include: { sourceContent: { include: { creator: true, metricSnapshots: { orderBy: { capturedAt: 'desc' }, take: 1 }, mediaCandidates: { where: { role: { in: ['COVER', 'COVER_169', 'ORIGIN_COVER'] } }, orderBy: { observedAt: 'desc' }, take: 1 }, categoryLinks: { include: { sourceCategory: true } } } } },
      orderBy: [{ discoveredAt: 'desc' }, { id: 'asc' }], take: query.limit + 1,
    });
    const selected = rows.slice(0, query.limit);
    return { items: selected.map(itemView), nextCursor: rows.length > query.limit ? encodeCursor(selected.at(-1)!.discoveredAt, selected.at(-1)!.id) : null };
  }
  async createWatchlist(input: CreateWatchlist, key: string, requestHash: string, identity: string) {
    return this.idempotent('CREATE_WATCHLIST', key, requestHash, async (tx) => watchlistView(await tx.watchlist.create({ data: { id: uuidV7(), sourceAccountId: input.sourceAccountId, mode: input.mode, resolvedInput: { url: input.input }, resolvedIdentity: identity, displayName: input.displayName.trim(), scheduleIntervalMin: input.scheduleIntervalMin, nextRunAt: new Date() } })), 'WATCHLIST_DUPLICATE');
  }
  async listWatchlists() { return { items: (await this.prisma.watchlist.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(watchlistView) }; }
  async updateWatchlist(id: string, version: number, input: UpdateWatchlist) {
    const result = await this.prisma.watchlist.updateMany({ where: { id, version }, data: { ...input, version: { increment: 1 } } });
    if (!result.count) { const exists = await this.prisma.watchlist.findUnique({ where: { id } }); if (!exists) notFound('WATCHLIST_NOT_FOUND', 'Watchlist was not found'); throw new DiscoveryError('WATCHLIST_VERSION_CONFLICT', 'Watchlist changed since it was loaded'); }
    return watchlistView(await this.prisma.watchlist.findUniqueOrThrow({ where: { id } }));
  }
  async deleteWatchlist(id: string, version: number) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.watchlist.findUnique({ where: { id } });
      if (!row) notFound('WATCHLIST_NOT_FOUND', 'Watchlist was not found');
      if (row.version !== version) throw new DiscoveryError('WATCHLIST_VERSION_CONFLICT', 'Watchlist changed since it was loaded');
      const active = await tx.discoveryRun.count({ where: { watchlistId: id, status: { in: ['QUEUED', 'RUNNING'] } } });
      if (active) throw new DiscoveryError('WATCHLIST_RUN_ACTIVE', 'Watchlist has an active run');
      await tx.watchlist.delete({ where: { id } }); return { id };
    });
  }
  async watchlist(id: string) { const row = await this.prisma.watchlist.findUnique({ where: { id } }); if (!row) notFound('WATCHLIST_NOT_FOUND', 'Watchlist was not found'); return row; }

  private async idempotent<T>(scope: string, key: string, requestHash: string, action: (tx: Prisma.TransactionClient) => Promise<T>, duplicateCode?: 'WATCHLIST_DUPLICATE' | 'WATCHLIST_RUN_ACTIVE'): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const previous = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
        if (previous) { if (previous.requestHash !== requestHash) invalid('Idempotency key was used for another request'); return previous.responseBody as T; }
        const result = await action(tx); const version = typeof result === 'object' && result && 'version' in result ? String((result as { version: number }).version) : '1';
        await tx.idempotencyRecord.create({ data: { id: uuidV7(), scope, key, requestHash, responseBody: result as Prisma.InputJsonValue, responseEtag: `"${version}"` } }); return result;
      });
    } catch (error) {
      const winner = await this.prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
      if (winner?.requestHash === requestHash) return winner.responseBody as T;
      if (duplicateCode && isUnique(error)) throw new DiscoveryError(duplicateCode, duplicateCode === 'WATCHLIST_DUPLICATE' ? 'This source is already in the watchlist' : 'Watchlist already has an active run');
      throw error;
    }
  }
}

type AccountRow = Prisma.SourceAccountGetPayload<{ include: typeof accountInclude }>;
function accountView(row: AccountRow) { const credential = row.credentials[0]; return { id: row.id, platform: row.platform, displayName: row.displayName, status: row.status, credential: credential ? { kind: credential.kind, importedAt: credential.encryptedAt.toISOString(), expiresAt: credential.expiresAt?.toISOString() ?? null } : null, lastValidatedAt: row.lastValidatedAt?.toISOString() ?? null, lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null, consecutiveFailures: row.consecutiveFailures, cooldownUntil: row.cooldownUntil?.toISOString() ?? null, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
function runView(row: { id: string; sourceAccountId: string; mode: string; status: string; input: string | null; query: string | null; categoryId: string | null; watchlistId: string | null; requestedLimit: number | null; pageCount: number; itemCount: number; skippedCounts: unknown; errorCode: string | null; errorDetailSafe: string | null; version: number; startedAt: Date | null; finishedAt: Date | null; createdAt: Date; updatedAt: Date }) { return { id: row.id, sourceAccountId: row.sourceAccountId, mode: row.mode, status: row.status, input: row.input, query: row.query, categoryId: row.categoryId, watchlistId: row.watchlistId, requestedLimit: row.requestedLimit, pageCount: row.pageCount, itemCount: row.itemCount, skippedCounts: row.skippedCounts, errorCode: row.errorCode, errorDetail: row.errorDetailSafe, version: row.version, startedAt: row.startedAt?.toISOString() ?? null, finishedAt: row.finishedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
function watchlistView(row: { id: string; sourceAccountId: string; mode: string; resolvedInput: unknown; displayName: string; status: string; scheduleIntervalMin: number; nextRunAt: Date; lastRunAt: Date | null; lastSuccessAt: Date | null; consecutiveFailures: number; version: number; createdAt: Date; updatedAt: Date }) { return { id: row.id, sourceAccountId: row.sourceAccountId, mode: row.mode, resolvedInput: row.resolvedInput, displayName: row.displayName, status: row.status, scheduleIntervalMin: row.scheduleIntervalMin, nextRunAt: row.nextRunAt.toISOString(), lastRunAt: row.lastRunAt?.toISOString() ?? null, lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null, consecutiveFailures: row.consecutiveFailures, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
function itemView(row: Prisma.DiscoveryItemGetPayload<{ include: { sourceContent: { include: { creator: true; metricSnapshots: true; mediaCandidates: true; categoryLinks: { include: { sourceCategory: true } } } } } }>) { const content = row.sourceContent; const metrics = content.metricSnapshots[0]; const cover = content.mediaCandidates[0]; return { id: row.id, runId: row.discoveryRunId, rank: row.rank, discoveredAt: row.discoveredAt.toISOString(), sourceContent: { id: content.id, platform: content.platform, externalId: content.externalId, contentType: content.contentType, title: content.title, description: content.description, canonicalUrl: content.canonicalUrl, publishedAt: content.publishedAt?.toISOString() ?? null, durationMs: content.durationMs, width: content.width, height: content.height, availability: content.availability, ingestEligible: content.isIngestEligible, firstSeenAt: content.firstSeenAt.toISOString(), lastSeenAt: content.lastSeenAt.toISOString(), creator: content.creator ? { id: content.creator.id, externalId: content.creator.externalId, nickname: content.creator.nickname, profileUrl: content.creator.profileUrl } : null, categories: content.categoryLinks.map(({ sourceCategory }) => ({ id: sourceCategory.id, platform: sourceCategory.platform, externalKey: sourceCategory.externalKey, slug: sourceCategory.slug, label: sourceCategory.label, kind: sourceCategory.kind, parentId: sourceCategory.parentId })), cover: cover?.canonicalUrl ? { url: cover.canonicalUrl, requiresRefresh: cover.requiresRefresh } : null, metrics: metrics ? { capturedAt: metrics.capturedAt.toISOString(), playCount: metrics.playCount?.toString() ?? null, diggCount: metrics.diggCount?.toString() ?? null, commentCount: metrics.commentCount?.toString() ?? null, collectCount: metrics.collectCount?.toString() ?? null, shareCount: metrics.shareCount?.toString() ?? null } : null } }; }
function encodeCursor(discoveredAt: Date, id: string) { return Buffer.from(JSON.stringify([discoveredAt.toISOString(), id])).toString('base64url'); }
function decodeCursor(value: string) { try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown; if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') throw new Error(); const discoveredAt = new Date(parsed[0]); if (Number.isNaN(discoveredAt.getTime()) || !/^[0-9a-f-]{36}$/iu.test(parsed[1])) throw new Error(); return { discoveredAt, id: parsed[1] }; } catch { throw new DiscoveryError('DISCOVERY_CURSOR_INVALID', 'Invalid discovery cursor'); } }
function isUnique(error: unknown) { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'; }
function dedupeContents(contents: NormalizedContent[]) { const seen = new Set<string>(); return contents.filter((item) => item.externalId && !seen.has(item.externalId) && Boolean(seen.add(item.externalId))); }
function sanitizedPublicUrl(value: string | undefined) { if (!value) return null; return sanitizeProviderUrl(value).canonicalUrl; }
function metric(value: string | null | undefined) { return value === null || value === undefined ? null : BigInt(value); }
function mergeCounts(current: Prisma.JsonValue, added: Record<string, number>) { const base = typeof current === 'object' && current !== null && !Array.isArray(current) ? current as Record<string, Prisma.JsonValue> : {}; return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(added)])].map((key) => [key, Number(base[key] ?? 0) + (added[key] ?? 0)])); }
function invalid(message: string): never { throw new DiscoveryError('DISCOVERY_VALIDATION_FAILED', message); }
function notFound(code: 'SOURCE_ACCOUNT_NOT_FOUND' | 'DISCOVERY_RUN_NOT_FOUND' | 'WATCHLIST_NOT_FOUND', message: string): never { throw new DiscoveryError(code, message); }
