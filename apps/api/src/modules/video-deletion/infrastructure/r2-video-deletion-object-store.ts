import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';

import type { AesGcmCredentialCipher } from '../../settings';
import { VideoDeletionError } from '../domain/video-deletion-errors';

export interface VideoDeletionObjectStore { deleteObject(bucket: string | null, objectKey: string): Promise<void> }

/** The only place that issues DeleteObject for asset files; one exact bucket + key, never a prefix. */
export class R2VideoDeletionObjectStore implements VideoDeletionObjectStore {
  constructor(private readonly prisma: PrismaClient, private readonly cipher: AesGcmCredentialCipher) {}
  async deleteObject(bucket: string | null, objectKey: string): Promise<void> {
    const row = await this.prisma.systemSetting.findUnique({ where: { singletonKey: 'DEFAULT' }, include: { storageCredential: true } });
    if (!row?.storageCredential || !row.storageAccountId || !row.storageBucket) throw new VideoDeletionError('STORAGE_NOT_CONFIGURED', 'Object storage is not configured');
    if (bucket !== row.storageBucket) throw new VideoDeletionError('STORAGE_BUCKET_MISMATCH', 'Asset bucket does not match the configured bucket');
    const credentials = this.cipher.decrypt<{ accessKeyId: string; secretAccessKey: string }>({ payload: row.storageCredential.encryptedPayload, keyVersion: row.storageCredential.keyVersion });
    const client = new S3Client({ region: 'auto', endpoint: `https://${row.storageAccountId}.r2.cloudflarestorage.com`, credentials, forcePathStyle: true });
    try { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey })); } catch (error) { if (isMissing(error)) return; throw new VideoDeletionError('STORAGE_DELETE_FAILED', 'Object storage refused the delete'); }
  }
}
function isMissing(error: unknown) { const value = error as { name?: string; $metadata?: { httpStatusCode?: number } }; return value?.name === 'NoSuchKey' || value?.$metadata?.httpStatusCode === 404; }
