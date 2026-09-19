import type {
  CommittedProfileAsset,
  PendingProfileAsset,
  ProfileOwner,
  RequestProfileUpload,
} from '../domain/profile-assets';

export interface ProfileAssetRepository {
  createPending(owner: ProfileOwner, input: RequestProfileUpload, bucket: string, extension: string): Promise<PendingProfileAsset>;
  getPending(owner: ProfileOwner, assetId: string): Promise<PendingProfileAsset>;
  getAvailable(owner: ProfileOwner, linkId: string): Promise<PendingProfileAsset>;
  replayCommit(owner: ProfileOwner, idempotencyKey: string, requestHash: string): Promise<CommittedProfileAsset | null>;
  commit(owner: ProfileOwner, assetId: string, expectedVersion: number, expectedParentVersion: number | undefined, idempotencyKey: string, requestHash: string): Promise<CommittedProfileAsset>;
  detach(owner: ProfileOwner, linkId: string, expectedVersion: number, expectedParentVersion?: number): Promise<{ profileVersion: number; parentVersion?: number }>;
}

export interface ProfileObjectStore {
  target(): Promise<{ bucket: string }>;
  createUploadGrant(asset: PendingProfileAsset): Promise<{ url: string; headers: Record<string, string>; expiresAt: Date }>;
  createPreviewGrant(asset: PendingProfileAsset): Promise<{ url: string; expiresAt: Date }>;
  inspect(asset: PendingProfileAsset): Promise<{ byteSize: number; contentType: string }>;
}
