import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PrismaClient } from '@prisma/client';

import type { AesGcmCredentialCipher } from '../../settings';
import type { ProfileObjectStore } from '../application/asset-ports';
import { ProfileError } from '../domain/profile-errors';
import type { StoredAssetObject } from '../application/asset-ports';

const UPLOAD_TTL_SECONDS = 600;
const PREVIEW_TTL_SECONDS = 300;

export class R2ProfileObjectStore implements ProfileObjectStore {
  constructor(private readonly prisma: PrismaClient, private readonly cipher: AesGcmCredentialCipher) {}

  async target(): Promise<{ bucket: string }> {
    const settings = await this.settings();
    return { bucket: settings.bucket };
  }

  async createUploadGrant(asset: StoredAssetObject) {
    const settings = await this.settings();
    if (settings.bucket !== asset.bucket) unavailable('Storage target changed; request a new upload');
    const command = new PutObjectCommand({
      Bucket: asset.bucket, Key: asset.objectKey, ContentType: asset.contentType,
      ContentLength: asset.byteSize,
    });
    const url = await getSignedUrl(settings.client, command, { expiresIn: UPLOAD_TTL_SECONDS });
    return {
      url, headers: { 'Content-Type': asset.contentType },
      expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000),
    };
  }

  async inspect(asset: StoredAssetObject): Promise<{ byteSize: number; contentType: string }> {
    const settings = await this.settings();
    try {
      const result = await settings.client.send(new HeadObjectCommand({ Bucket: asset.bucket, Key: asset.objectKey }));
      if (result.ContentLength === undefined || !result.ContentType) unavailable('Uploaded object is missing required metadata');
      return { byteSize: result.ContentLength, contentType: result.ContentType };
    } catch (error) {
      if (error instanceof ProfileError) throw error;
      unavailable('Uploaded object could not be verified');
    }
  }

  async createPreviewGrant(asset: StoredAssetObject) {
    const settings = await this.settings();
    if (settings.bucket !== asset.bucket) unavailable('Storage target changed; asset preview is unavailable');
    const command = new GetObjectCommand({ Bucket: asset.bucket, Key: asset.objectKey });
    const url = await getSignedUrl(settings.client, command, { expiresIn: PREVIEW_TTL_SECONDS });
    return { url, expiresAt: new Date(Date.now() + PREVIEW_TTL_SECONDS * 1000) };
  }

  private async settings() {
    const row = await this.prisma.systemSetting.findUnique({
      where: { singletonKey: 'DEFAULT' }, include: { storageCredential: true },
    });
    if (!row?.storageCredential || !row.storageAccountId || !row.storageBucket) unavailable('Object storage is not configured');
    const credentials = this.cipher.decrypt<{ accessKeyId: string; secretAccessKey: string }>({
      payload: row.storageCredential.encryptedPayload, keyVersion: row.storageCredential.keyVersion,
    });
    return {
      bucket: row.storageBucket,
      client: new S3Client({
        region: 'auto', endpoint: `https://${row.storageAccountId}.r2.cloudflarestorage.com`,
        credentials, forcePathStyle: true,
      }),
    };
  }
}

function unavailable(message: string): never {
  throw new ProfileError('PROFILE_ASSET_NOT_AVAILABLE', message);
}
