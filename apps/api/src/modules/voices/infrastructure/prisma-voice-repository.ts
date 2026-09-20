import type { Prisma, PrismaClient } from '@prisma/client';
import { uuidV7 } from '../../../platform/ids/uuid-v7';
import type { VoiceRepository } from '../application/ports';
import { VoiceError } from '../domain/voice-errors';
import type { CreateVoiceProfile, UpdateVoiceProfile, VoiceListQuery, VoiceProfileView } from '../domain/voices';

const include = {
  samples: { where: { isCurrent: true }, include: { asset: true }, orderBy: { language: 'asc' as const } },
  _count: { select: { channelDefaults: { where: { status: { not: 'ARCHIVED' as const } } }, seriesOverrides: { where: { status: { not: 'ARCHIVED' as const } } } } },
} satisfies Prisma.VoiceProfileInclude;
type Row = Prisma.VoiceProfileGetPayload<{ include: typeof include }>;

export class PrismaVoiceRepository implements VoiceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(query: VoiceListQuery) {
    const after = query.cursor ? decode(query.cursor) : undefined;
    const rows = await this.prisma.voiceProfile.findMany({
      where: {
        ...(query.status ? { status: query.status } : { status: { not: 'ARCHIVED' as const } }),
        ...(query.query ? { name: { contains: query.query, mode: 'insensitive' as const } } : {}),
        ...(query.language ? { primaryLanguage: query.language } : {}),
        ...(query.tag ? { tags: { has: query.tag } } : {}),
        ...(query.commercialUseAllowed !== undefined ? { commercialUseAllowed: query.commercialUseAllowed } : {}),
        ...(after ? { id: { gt: after } } : {}),
      }, include, orderBy: { id: 'asc' }, take: query.limit + 1,
    });
    const selected = rows.slice(0, query.limit);
    return { items: selected.map(view), nextCursor: rows.length > query.limit ? encode(selected.at(-1)!.id) : null };
  }

  async get(id: string) { const row = await this.find(id); return view(row); }

  async create(input: CreateVoiceProfile, key: string, requestHash: string) {
    return this.idempotent(key, requestHash, async (tx) => view(await tx.voiceProfile.create({ data: {
      id: uuidV7(), name: input.name.trim(), normalizedName: normalize(input.name),
      primaryLanguage: input.primaryLanguage, description: input.description, tags: normalizedTags(input.tags),
      licenseKind: input.licenseKind, licenseReference: input.licenseReference,
      sourceReference: input.sourceReference, commercialUseAllowed: input.commercialUseAllowed,
    }, include })));
  }

  async update(id: string, version: number, input: UpdateVoiceProfile) {
    return this.write(async (tx) => {
      const current = await tx.voiceProfile.findUnique({ where: { id } });
      if (!current) notFound();
      if (current.status === 'ARCHIVED') throw new VoiceError('VOICE_ARCHIVED', 'Restore the voice before editing');
      if (current.version !== version) conflict();
      const licenseKind = input.licenseKind ?? current.licenseKind;
      const requestedAllowed = input.commercialUseAllowed ?? current.commercialUseAllowed;
      const allowed = licenseKind === 'CC_BY_NC' || licenseKind === 'UNKNOWN' ? false : requestedAllowed;
      const licenseReference = input.licenseReference !== undefined ? input.licenseReference : current.licenseReference;
      if (allowed && licenseKind !== 'OWNED_RECORDING' && !licenseReference?.trim()) invalid('Commercial use requires a license reference');
      const blocked = !allowed || licenseKind === 'CC_BY_NC' || licenseKind === 'UNKNOWN';
      const result = await tx.voiceProfile.updateMany({ where: { id, version }, data: {
        version: { increment: 1 }, ...(input.name !== undefined ? { name: input.name.trim(), normalizedName: normalize(input.name) } : {}),
        ...(input.primaryLanguage !== undefined ? { primaryLanguage: input.primaryLanguage } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.tags !== undefined ? { tags: normalizedTags(input.tags) } : {}),
        ...(input.licenseKind !== undefined ? { licenseKind: input.licenseKind } : {}),
        ...(input.licenseReference !== undefined ? { licenseReference: input.licenseReference } : {}),
        ...(input.sourceReference !== undefined ? { sourceReference: input.sourceReference } : {}),
        ...(input.commercialUseAllowed !== undefined || allowed !== current.commercialUseAllowed ? { commercialUseAllowed: allowed } : {}),
        ...(current.status === 'READY' && blocked ? { status: 'BLOCKED_LICENSE' as const } : {}),
      } });
      if (result.count !== 1) conflict();
      let updated = await tx.voiceProfile.findUniqueOrThrow({ where: { id }, include });
      const updatedView = view(updated);
      if (current.status === 'READY' && updatedView.readiness !== 'READY' && updated.status === 'READY') {
        await tx.voiceProfile.update({ where: { id }, data: { status: 'DRAFT' } });
        updated = await tx.voiceProfile.findUniqueOrThrow({ where: { id }, include });
      }
      return view(updated);
    });
  }

  activate(id: string, version: number) {
    return this.write(async (tx) => {
      const row = await tx.voiceProfile.findUnique({ where: { id }, include });
      if (!row) notFound();
      if (row.version !== version) conflict();
      if (row.status === 'ARCHIVED') throw new VoiceError('VOICE_ARCHIVED', 'Restore the voice before activation');
      const result = view(row);
      if (row.status === 'READY' && result.readiness === 'READY') return result;
      const licenseBlocked = result.readinessIssues.some((issue) => issue.includes('LICENSE') || issue.includes('COMMERCIAL'));
      if (licenseBlocked) {
        return view(await tx.voiceProfile.update({ where: { id }, data: { status: 'BLOCKED_LICENSE', version: { increment: 1 } }, include }));
      }
      if (result.readiness !== 'READY') throw new VoiceError('VOICE_NOT_READY', `Voice is not ready: ${result.readinessIssues.join(', ')}`);
      return view(await tx.voiceProfile.update({ where: { id }, data: { status: 'READY', version: { increment: 1 } }, include }));
    });
  }

  archive(id: string, version: number) {
    return this.write(async (tx) => {
      const row = await tx.voiceProfile.findUnique({ where: { id }, include });
      if (!row) notFound(); if (row.version !== version) conflict();
      if (row.status === 'ARCHIVED') return view(row);
      if (row._count.channelDefaults + row._count.seriesOverrides > 0) throw new VoiceError('VOICE_IN_USE', 'Voice is referenced by an active profile');
      return view(await tx.voiceProfile.update({ where: { id }, data: { status: 'ARCHIVED', version: { increment: 1 } }, include }));
    });
  }

  restore(id: string, version: number) {
    return this.write(async (tx) => {
      const row = await tx.voiceProfile.findUnique({ where: { id }, include });
      if (!row) notFound(); if (row.version !== version) conflict();
      if (row.status !== 'ARCHIVED') return view(row);
      return view(await tx.voiceProfile.update({ where: { id }, data: { status: 'DRAFT', version: { increment: 1 } }, include }));
    });
  }

  private async find(id: string) { const row = await this.prisma.voiceProfile.findUnique({ where: { id }, include }); if (!row) notFound(); return row; }
  private async idempotent(key: string, requestHash: string, action: (tx: Prisma.TransactionClient) => Promise<VoiceProfileView>) {
    try {
      return await this.write(async (tx) => {
        const previous = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope: 'CREATE_VOICE_PROFILE', key } } });
        if (previous) { if (previous.requestHash !== requestHash) invalid('Idempotency key was used for another request'); return previous.responseBody as unknown as VoiceProfileView; }
        const result = await action(tx);
        await tx.idempotencyRecord.create({ data: { id: uuidV7(), scope: 'CREATE_VOICE_PROFILE', key, requestHash, responseBody: result as unknown as Prisma.InputJsonValue, responseEtag: `"${result.version}"` } });
        return result;
      });
    } catch (error) {
      const winner = await this.prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope: 'CREATE_VOICE_PROFILE', key } } });
      if (winner?.requestHash === requestHash) return winner.responseBody as unknown as VoiceProfileView;
      throw error;
    }
  }
  private async write<T>(action: (tx: Prisma.TransactionClient) => Promise<T>) {
    try { return await this.prisma.$transaction(action); } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') throw new VoiceError('VOICE_NAME_CONFLICT', 'A voice with this name already exists');
      throw error;
    }
  }
}

export function view(row: Row): VoiceProfileView {
  const issues: string[] = [];
  if (!row.commercialUseAllowed) issues.push('VOICE_COMMERCIAL_USE_NOT_ALLOWED');
  if (row.licenseKind === 'CC_BY_NC' || row.licenseKind === 'UNKNOWN') issues.push('VOICE_COMMERCIAL_USE_NOT_ALLOWED');
  if (row.commercialUseAllowed && row.licenseKind !== 'OWNED_RECORDING' && !row.licenseReference?.trim()) issues.push('VOICE_LICENSE_REFERENCE_REQUIRED');
  const primary = row.samples.find((sample) => sample.language.toLowerCase() === row.primaryLanguage.toLowerCase());
  if (!primary) issues.push('VOICE_PRIMARY_SAMPLE_REQUIRED');
  return {
    id: row.id, name: row.name, primaryLanguage: row.primaryLanguage, description: row.description,
    tags: row.tags, status: row.status, licenseKind: row.licenseKind, licenseReference: row.licenseReference,
    sourceReference: row.sourceReference, commercialUseAllowed: row.commercialUseAllowed,
    samples: row.samples.map((sample) => ({ id: sample.id, assetId: sample.assetId, language: sample.language,
      transcript: sample.transcript, durationMs: sample.durationMs, fileName: sample.asset.fileName,
      contentType: sample.asset.contentType ?? '', byteSize: sample.asset.byteSize?.toString() ?? '0', revision: sample.revision })),
    readiness: issues.length ? 'NEEDS_CONFIGURATION' : 'READY', readinessIssues: [...new Set(issues)],
    referencedBy: { channelProfiles: row._count.channelDefaults, seriesProfiles: row._count.seriesOverrides },
    version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}
function normalize(value: string) { return value.trim().normalize('NFKC').toLocaleLowerCase('en-US'); }
function normalizedTags(tags: string[]) { return [...new Set(tags.map((tag) => tag.trim().toLocaleLowerCase('en-US')))]; }
function encode(id: string) { return Buffer.from(id).toString('base64url'); }
function decode(cursor: string) { const id = Buffer.from(cursor, 'base64url').toString('utf8'); if (!/^[0-9a-f-]{36}$/iu.test(id)) invalid('Invalid cursor'); return id; }
function notFound(): never { throw new VoiceError('VOICE_NOT_FOUND', 'Voice profile was not found'); }
function conflict(): never { throw new VoiceError('VOICE_VERSION_CONFLICT', 'Voice changed since it was loaded'); }
function invalid(message: string): never { throw new VoiceError('VOICE_VALIDATION_FAILED', message); }
