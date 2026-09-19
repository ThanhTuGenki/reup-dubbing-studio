import type { Prisma, PrismaClient } from '@prisma/client';

import { uuidV7 } from '../../../platform/ids/uuid-v7';
import type { ProfileAssetRepository } from '../application/asset-ports';
import { ProfileError } from '../domain/profile-errors';
import type { CommittedProfileAsset, PendingProfileAsset, ProfileOwner, RequestProfileUpload } from '../domain/profile-assets';

type Tx = Prisma.TransactionClient;

export class PrismaProfileAssetRepository implements ProfileAssetRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createPending(owner: ProfileOwner, input: RequestProfileUpload, bucket: string, extension: string): Promise<PendingProfileAsset> {
    await this.ensureOwner(this.prisma, owner);
    const id = uuidV7();
    const objectKey = `profiles/${owner.type.toLocaleLowerCase('en-US')}/${owner.id}/${id}.${extension}`;
    const row = await this.prisma.asset.create({ data: {
      id, storageBackend: 'R2', bucket, objectKey, fileName: input.fileName.trim(),
      byteSize: BigInt(input.byteSize), contentType: input.contentType,
      ...(input.checksumSha256 !== undefined ? { checksumSha256: input.checksumSha256 } : {}),
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
      metadata: { ownerType: owner.type, ownerId: owner.id, role: input.role },
    } });
    return pendingView(row, input.role);
  }

  async getPending(owner: ProfileOwner, assetId: string): Promise<PendingProfileAsset> {
    const row = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!row || row.status !== 'PENDING' || !ownedBy(row.metadata, owner)) {
      throw new ProfileError('PROFILE_ASSET_NOT_AVAILABLE', 'Pending profile asset was not found');
    }
    return pendingView(row, metadataRole(row.metadata));
  }

  async getAvailable(owner: ProfileOwner, linkId: string): Promise<PendingProfileAsset> {
    if (owner.type === 'CHANNEL') {
      const link = await this.prisma.channelProfileAsset.findUnique({ where: { id: linkId }, include: { asset: true } });
      if (!link || link.channelProfileId !== owner.id || !link.isCurrent || link.asset.status !== 'AVAILABLE') unavailable();
      return pendingView(link.asset, metadataRole(link.asset.metadata));
    }
    const link = await this.prisma.seriesProfileAsset.findUnique({ where: { id: linkId }, include: { asset: true } });
    if (!link || link.seriesProfileId !== owner.id || !link.isCurrent || link.asset.status !== 'AVAILABLE') unavailable();
    return pendingView(link.asset, metadataRole(link.asset.metadata));
  }

  async replayCommit(owner: ProfileOwner, idempotencyKey: string, requestHash: string): Promise<CommittedProfileAsset | null> {
    const scope = `COMMIT_${owner.type}_PROFILE_ASSET`;
    const previous = await this.prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope, key: idempotencyKey } } });
    if (!previous) return null;
    if (previous.requestHash !== requestHash) throw new ProfileError('PROFILE_VALIDATION_FAILED', 'Idempotency key was used for a different request');
    return previous.responseBody as unknown as CommittedProfileAsset;
  }

  async commit(owner: ProfileOwner, assetId: string, expectedVersion: number, expectedParentVersion: number | undefined, idempotencyKey: string, requestHash: string): Promise<CommittedProfileAsset> {
    const scope = `COMMIT_${owner.type}_PROFILE_ASSET`;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const previous = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key: idempotencyKey } } });
        if (previous) {
          if (previous.requestHash !== requestHash) throw new ProfileError('PROFILE_VALIDATION_FAILED', 'Idempotency key was used for a different request');
          return previous.responseBody as unknown as CommittedProfileAsset;
        }
        await this.ensureOwnerVersion(tx, owner, expectedVersion, expectedParentVersion);
        const asset = await tx.asset.findUnique({ where: { id: assetId } });
        if (!asset || asset.status !== 'PENDING' || !ownedBy(asset.metadata, owner)) {
          throw new ProfileError('PROFILE_ASSET_NOT_AVAILABLE', 'Pending profile asset was not found');
        }
        const role = metadataRole(asset.metadata);
        const result = owner.type === 'CHANNEL'
          ? await commitChannel(tx, owner.id, asset, channelRole(role))
          : await commitSeries(tx, owner.id, asset, seriesRole(role));
        await tx.asset.update({ where: { id: assetId }, data: {
          status: 'AVAILABLE', uploadedAt: new Date(), verifiedAt: new Date(), version: { increment: 1 },
        } });
        await tx.idempotencyRecord.create({ data: {
          id: uuidV7(), scope, key: idempotencyKey, requestHash,
          responseBody: result as unknown as Prisma.InputJsonValue,
          responseEtag: owner.type === 'CHANNEL' ? `"${result.profileVersion}"` : `"${result.profileVersion}:${result.parentVersion}"`,
        } });
        return result;
      });
    } catch (error) {
      const replay = await this.replayCommit(owner, idempotencyKey, requestHash);
      if (replay) return replay;
      throw error;
    }
  }

  detach(owner: ProfileOwner, linkId: string, expectedVersion: number, expectedParentVersion?: number) {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureOwnerVersion(tx, owner, expectedVersion, expectedParentVersion);
      if (owner.type === 'CHANNEL') {
        const link = await tx.channelProfileAsset.findUnique({ where: { id: linkId } });
        if (!link || link.channelProfileId !== owner.id || !link.isCurrent) unavailable();
        await tx.channelProfileAsset.update({ where: { id: linkId }, data: { isCurrent: false } });
        const profile = await tx.channelProfile.update({ where: { id: owner.id }, data: { version: { increment: 1 } } });
        return { profileVersion: profile.version };
      }
      const link = await tx.seriesProfileAsset.findUnique({ where: { id: linkId } });
      if (!link || link.seriesProfileId !== owner.id || !link.isCurrent) unavailable();
      await tx.seriesProfileAsset.update({ where: { id: linkId }, data: { isCurrent: false } });
      const profile = await tx.seriesProfile.update({ where: { id: owner.id }, data: { version: { increment: 1 } }, include: { channelProfile: true } });
      return { profileVersion: profile.version, parentVersion: profile.channelProfile.version };
    });
  }

  private async ensureOwner(client: Tx | PrismaClient, owner: ProfileOwner): Promise<void> {
    const profile = owner.type === 'CHANNEL'
      ? await client.channelProfile.findUnique({ where: { id: owner.id }, select: { status: true } })
      : await client.seriesProfile.findUnique({ where: { id: owner.id }, select: { status: true } });
    if (!profile) throw new ProfileError('PROFILE_NOT_FOUND', 'Profile was not found');
    if (profile.status === 'ARCHIVED') throw new ProfileError('PROFILE_ARCHIVED', 'Archived profile cannot accept assets');
  }

  private async ensureOwnerVersion(tx: Tx, owner: ProfileOwner, version: number, parentVersion?: number): Promise<void> {
    if (owner.type === 'CHANNEL') {
      const profile = await tx.channelProfile.findUnique({ where: { id: owner.id } });
      if (!profile) throw new ProfileError('PROFILE_NOT_FOUND', 'Profile was not found');
      if (profile.status === 'ARCHIVED') throw new ProfileError('PROFILE_ARCHIVED', 'Archived profile cannot accept assets');
      if (profile.version !== version) conflict();
      return;
    }
    const profile = await tx.seriesProfile.findUnique({ where: { id: owner.id }, include: { channelProfile: true } });
    if (!profile) throw new ProfileError('PROFILE_NOT_FOUND', 'Profile was not found');
    if (profile.status === 'ARCHIVED') throw new ProfileError('PROFILE_ARCHIVED', 'Archived profile cannot accept assets');
    if (profile.channelProfile.status === 'ARCHIVED') throw new ProfileError('PROFILE_PARENT_ARCHIVED', 'Parent channel is archived');
    if (profile.version !== version || profile.channelProfile.version !== parentVersion) conflict();
  }
}

async function commitChannel(tx: Tx, profileId: string, asset: AssetRow, role: 'INTRO' | 'OUTRO' | 'LOGO' | 'WATERMARK'): Promise<CommittedProfileAsset> {
  const latest = await tx.channelProfileAsset.aggregate({ where: { channelProfileId: profileId, role }, _max: { revision: true } });
  await tx.channelProfileAsset.updateMany({ where: { channelProfileId: profileId, role, isCurrent: true }, data: { isCurrent: false } });
  const revision = (latest._max.revision ?? 0) + 1;
  const link = await tx.channelProfileAsset.create({ data: { id: uuidV7(), channelProfileId: profileId, assetId: asset.id, role, revision } });
  const profile = await tx.channelProfile.update({ where: { id: profileId }, data: { version: { increment: 1 } } });
  return { asset: assetView(link.id, asset, role, revision), profileVersion: profile.version };
}

async function commitSeries(tx: Tx, profileId: string, asset: AssetRow, role: 'MASK_REFERENCE_FRAME'): Promise<CommittedProfileAsset> {
  const latest = await tx.seriesProfileAsset.aggregate({ where: { seriesProfileId: profileId, role }, _max: { revision: true } });
  await tx.seriesProfileAsset.updateMany({ where: { seriesProfileId: profileId, role, isCurrent: true }, data: { isCurrent: false } });
  const revision = (latest._max.revision ?? 0) + 1;
  const link = await tx.seriesProfileAsset.create({ data: { id: uuidV7(), seriesProfileId: profileId, assetId: asset.id, role, revision } });
  const profile = await tx.seriesProfile.update({ where: { id: profileId }, data: { version: { increment: 1 } }, include: { channelProfile: true } });
  return { asset: assetView(link.id, asset, role, revision), profileVersion: profile.version, parentVersion: profile.channelProfile.version };
}

type AssetRow = Awaited<ReturnType<PrismaClient['asset']['findUniqueOrThrow']>>;
function pendingView(row: AssetRow, role: RequestProfileUpload['role']): PendingProfileAsset {
  if (row.byteSize === null || row.contentType === null || row.bucket === null) unavailable();
  const size = Number(row.byteSize);
  if (!Number.isSafeInteger(size)) unavailable();
  return {
    id: row.id, role, fileName: row.fileName, contentType: row.contentType, byteSize: size,
    ...(row.checksumSha256 ? { checksumSha256: row.checksumSha256 } : {}),
    ...(row.width ? { width: row.width } : {}), ...(row.height ? { height: row.height } : {}),
    bucket: row.bucket, objectKey: row.objectKey,
  };
}
function assetView(linkId: string, asset: AssetRow, role: RequestProfileUpload['role'], revision: number) {
  return {
    linkId, assetId: asset.id, role, fileName: asset.fileName, contentType: asset.contentType,
    byteSize: asset.byteSize?.toString() ?? null, width: asset.width, height: asset.height, revision,
  };
}
function metadata(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {};
}
function ownedBy(value: Prisma.JsonValue, owner: ProfileOwner): boolean {
  const data = metadata(value); return data.ownerType === owner.type && data.ownerId === owner.id;
}
function metadataRole(value: Prisma.JsonValue): RequestProfileUpload['role'] {
  const role = metadata(value).role;
  if (role === 'INTRO' || role === 'OUTRO' || role === 'LOGO' || role === 'WATERMARK' || role === 'MASK_REFERENCE_FRAME') return role;
  throw new ProfileError('PROFILE_ASSET_ROLE_INVALID', 'Stored profile asset role is invalid');
}
function channelRole(role: RequestProfileUpload['role']) {
  if (role === 'MASK_REFERENCE_FRAME') throw new ProfileError('PROFILE_ASSET_ROLE_INVALID', 'Invalid channel asset role');
  return role;
}
function seriesRole(role: RequestProfileUpload['role']): 'MASK_REFERENCE_FRAME' {
  if (role !== 'MASK_REFERENCE_FRAME') throw new ProfileError('PROFILE_ASSET_ROLE_INVALID', 'Invalid series asset role');
  return role;
}
function unavailable(): never { throw new ProfileError('PROFILE_ASSET_NOT_AVAILABLE', 'Profile asset was not found or is no longer current'); }
function conflict(): never { throw new ProfileError('PROFILE_VERSION_CONFLICT', 'Profile changed since it was loaded'); }
