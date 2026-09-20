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
  createUploadGrant(asset: StoredAssetObject): Promise<{ url: string; headers: Record<string, string>; expiresAt: Date }>;
  createPreviewGrant(asset: StoredAssetObject): Promise<{ url: string; expiresAt: Date }>;
  inspect(asset: StoredAssetObject): Promise<{ byteSize: number; contentType: string }>;
}

export type StoredAssetObject = Pick<PendingProfileAsset, 'id' | 'bucket' | 'objectKey' | 'contentType' | 'byteSize'>;
