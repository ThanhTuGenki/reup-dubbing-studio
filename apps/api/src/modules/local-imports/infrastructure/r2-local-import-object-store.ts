import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PrismaClient } from '@prisma/client';

import type { AesGcmCredentialCipher } from '../../settings';
import { LocalImportError } from '../domain/local-import-errors';
import type { PendingLocalImport } from './prisma-local-import-repository';

const UPLOAD_TTL_SECONDS = 600;

export class R2LocalImportObjectStore {
  constructor(private readonly prisma: PrismaClient, private readonly cipher: AesGcmCredentialCipher) {}

  async target(): Promise<{ bucket: string }> {
    const settings = await this.settings();
    return { bucket: settings.bucket };
  }

  async createUploadGrant(asset: PendingLocalImport) {
    const settings = await this.settings();
    if (settings.bucket !== asset.bucket) unavailable('Storage target changed; request a new upload');
    const command = new PutObjectCommand({
      Bucket: asset.bucket,
      Key: asset.objectKey,
      ContentType: asset.contentType,
      ContentLength: asset.byteSize,
      Metadata: { sha256: asset.checksumSha256 },
    });
    const url = await getSignedUrl(settings.client, command, {
      expiresIn: UPLOAD_TTL_SECONDS,
      unhoistableHeaders: new Set(['x-amz-meta-sha256']),
    });
    return {
      assetId: asset.id,
      method: 'PUT' as const,
      url,
      headers: { 'Content-Type': asset.contentType, 'x-amz-meta-sha256': asset.checksumSha256 },
      expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000).toISOString(),
      maxByteSize: asset.byteSize,
    };
  }

  async inspect(asset: PendingLocalImport): Promise<{ byteSize: number; contentType: string; checksumSha256: string | null }> {
    const settings = await this.settings();
    try {
      const result = await settings.client.send(new HeadObjectCommand({ Bucket: asset.bucket, Key: asset.objectKey }));
      if (result.ContentLength === undefined || !result.ContentType) unavailable('Uploaded video is missing required metadata');
      return {
        byteSize: result.ContentLength,
        contentType: result.ContentType,
        checksumSha256: result.Metadata?.sha256 ?? null,
      };
    } catch (error) {
      if (error instanceof LocalImportError) throw error;
      unavailable('Uploaded video could not be verified');
    }
  }

  private async settings() {
    const row = await this.prisma.systemSetting.findUnique({
      where: { singletonKey: 'DEFAULT' }, include: { storageCredential: true },
    });
    if (!row?.storageCredential || !row.storageAccountId || !row.storageBucket) unavailable('Object storage is not configured');
    const credentials = this.cipher.decrypt<{ accessKeyId: string; secretAccessKey: string }>({
      payload: row.storageCredential.encryptedPayload,
      keyVersion: row.storageCredential.keyVersion,
    });
    return {
      bucket: row.storageBucket,
      client: new S3Client({
        region: 'auto',
        endpoint: `https://${row.storageAccountId}.r2.cloudflarestorage.com`,
        credentials,
        forcePathStyle: true,
      }),
    };
  }
}

function unavailable(message: string): never {
  throw new LocalImportError('LOCAL_IMPORT_NOT_AVAILABLE', message);
}
