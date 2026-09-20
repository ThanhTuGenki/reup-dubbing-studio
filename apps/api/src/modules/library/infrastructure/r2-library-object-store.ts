import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PrismaClient } from '@prisma/client';
import type { AesGcmCredentialCipher } from '../../settings';
import { LibraryError } from '../domain/library-errors';
import type { GrantPurpose } from '../domain/library';

export type GrantAsset = { bucket: string | null; objectKey: string; fileName: string; contentType: string | null; byteSize: bigint | null };
export class R2LibraryObjectStore {
  constructor(private readonly prisma: PrismaClient, private readonly cipher: AesGcmCredentialCipher) {}
  async createGrant(asset: GrantAsset, purpose: GrantPurpose) {
    const row = await this.prisma.systemSetting.findUnique({ where: { singletonKey: 'DEFAULT' }, include: { storageCredential: true } });
    if (!row?.storageCredential || !row.storageAccountId || !row.storageBucket || asset.bucket !== row.storageBucket) throw new LibraryError('LIBRARY_ASSET_NOT_AVAILABLE', 'Object storage is not available');
    const credentials = this.cipher.decrypt<{ accessKeyId: string; secretAccessKey: string }>({ payload: row.storageCredential.encryptedPayload, keyVersion: row.storageCredential.keyVersion });
    const client = new S3Client({ region: 'auto', endpoint: `https://${row.storageAccountId}.r2.cloudflarestorage.com`, credentials, forcePathStyle: true });
    const command = new GetObjectCommand({ Bucket: asset.bucket, Key: asset.objectKey, ResponseContentDisposition: `${purpose === 'download' ? 'attachment' : 'inline'}; filename="${safeName(asset.fileName)}"` });
    const ttl = 300;
    return { url: await getSignedUrl(client, command, { expiresIn: ttl }), expiresAt: new Date(Date.now() + ttl * 1000) };
  }
}
function safeName(value: string) { return value.replace(/["\r\n\\]/gu, '_'); }
