import { createHash } from 'node:crypto';

import type { ProfileAssetRepository, ProfileObjectStore } from './asset-ports';
import { ProfileError } from '../domain/profile-errors';
import type { ProfileOwner, RequestProfileUpload } from '../domain/profile-assets';

export class ProfileAssetsService {
  constructor(private readonly repository: ProfileAssetRepository, private readonly objectStore: ProfileObjectStore) {}

  async requestUpload(owner: ProfileOwner, input: RequestProfileUpload) {
    const extension = validateUpload(owner, input);
    const normalized = { ...input, contentType: canonicalMime(input.contentType) };
    const { bucket } = await this.objectStore.target();
    const pending = await this.repository.createPending(owner, normalized, bucket, extension);
    const grant = await this.objectStore.createUploadGrant(pending);
    return {
      assetId: pending.id, method: 'PUT' as const, url: grant.url, headers: grant.headers,
      expiresAt: grant.expiresAt.toISOString(), maxByteSize: normalized.byteSize,
    };
  }

  async refreshUpload(owner: ProfileOwner, assetId: string) {
    const pending = await this.repository.getPending(owner, assetId);
    const grant = await this.objectStore.createUploadGrant(pending);
    return {
      assetId: pending.id, method: 'PUT' as const, url: grant.url, headers: grant.headers,
      expiresAt: grant.expiresAt.toISOString(), maxByteSize: pending.byteSize,
    };
  }

  async commit(owner: ProfileOwner, assetId: string, expectedVersion: number, expectedParentVersion: number | undefined, idempotencyKey: string) {
    const requestHash = createHash('sha256')
      .update(`${owner.type}:${owner.id}:${assetId}:${expectedVersion}:${expectedParentVersion ?? ''}`).digest('hex');
    const replay = await this.repository.replayCommit(owner, idempotencyKey, requestHash);
    if (replay) return replay;
    const pending = await this.repository.getPending(owner, assetId);
    const remote = await this.objectStore.inspect(pending);
    if (remote.byteSize !== pending.byteSize || canonicalMime(remote.contentType) !== pending.contentType) {
      throw new ProfileError('PROFILE_ASSET_NOT_AVAILABLE', 'Uploaded object metadata does not match the authorized asset');
    }
    return this.repository.commit(owner, assetId, expectedVersion, expectedParentVersion, idempotencyKey, requestHash);
  }

  detach(owner: ProfileOwner, linkId: string, version: number, parentVersion?: number) {
    return this.repository.detach(owner, linkId, version, parentVersion);
  }
}

const IMAGE_MIMES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function validateUpload(owner: ProfileOwner, input: RequestProfileUpload): string {
  if (!input.fileName.trim() || input.fileName.length > 255 || /[/\\]/u.test(input.fileName)) invalid('Invalid asset file name');
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0) invalid('Invalid asset byte size');
  if (input.checksumSha256 !== undefined && !/^[0-9a-f]{64}$/u.test(input.checksumSha256)) invalid('Invalid SHA-256 checksum');
  const mime = canonicalMime(input.contentType);
  if (owner.type === 'SERIES') {
    if (input.role !== 'MASK_REFERENCE_FRAME' || !IMAGE_MIMES[mime] || input.byteSize > 20 * 1024 * 1024) invalid('Invalid mask reference asset');
    if (!input.width || !input.height || input.width > 16_384 || input.height > 16_384) invalid('Reference frame dimensions are required');
    return IMAGE_MIMES[mime]!;
  }
  if (input.role === 'MASK_REFERENCE_FRAME') invalid('Invalid channel asset role');
  if (input.role === 'INTRO' || input.role === 'OUTRO') {
    if (mime !== 'video/mp4' || input.byteSize > 2 * 1024 * 1024 * 1024) invalid('Intro/outro must be an MP4 up to 2 GiB');
    return 'mp4';
  }
  if (!IMAGE_MIMES[mime] || input.byteSize > 20 * 1024 * 1024) invalid('Logo/watermark must be an image up to 20 MiB');
  return IMAGE_MIMES[mime]!;
}

function canonicalMime(value: string): string { return value.split(';', 1)[0]!.trim().toLocaleLowerCase('en-US'); }
function invalid(message: string): never { throw new ProfileError('PROFILE_ASSET_ROLE_INVALID', message); }
