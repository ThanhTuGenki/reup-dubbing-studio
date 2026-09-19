import type { ProfileAssetView } from './profiles';

export type ProfileOwner = { type: 'CHANNEL'; id: string } | { type: 'SERIES'; id: string };
export type ProfileAssetRole = ProfileAssetView['role'];

export type RequestProfileUpload = {
  role: ProfileAssetRole;
  fileName: string;
  contentType: string;
  byteSize: number;
  checksumSha256?: string;
  width?: number;
  height?: number;
};

export type PendingProfileAsset = RequestProfileUpload & {
  id: string;
  bucket: string;
  objectKey: string;
};

export type UploadGrant = {
  assetId: string;
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
  maxByteSize: number;
};

export type PreviewGrant = {
  assetId: string;
  method: 'GET';
  url: string;
  expiresAt: string;
  fileName: string;
  contentType: string;
  byteSize: number;
};

export type CommittedProfileAsset = { asset: ProfileAssetView; profileVersion: number; parentVersion?: number };
