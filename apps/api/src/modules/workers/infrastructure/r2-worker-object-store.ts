import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PrismaClient } from '@prisma/client';
import type { DownloadGrant, UploadGrant } from '@reup-dubbing-studio/api-contract/worker';
import type { AesGcmCredentialCipher } from '../../settings';
import { WorkerError } from '../domain/worker-errors';

type StoredAsset = { id: string; bucket: string | null; objectKey: string; fileName: string; contentType: string | null; byteSize: bigint | null; checksumSha256: string | null };
type UploadAsset = StoredAsset & { metadata: unknown };

export class R2WorkerObjectStore {
  constructor(private readonly prisma: PrismaClient, private readonly cipher: AesGcmCredentialCipher) {}

  async download(asset: StoredAsset, leaseExpiresAt: Date): Promise<DownloadGrant> {
    const { client, bucket } = await this.connection(asset.bucket);
    const ttl = ttlSeconds(leaseExpiresAt);
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: asset.objectKey, ResponseContentDisposition: `attachment; filename="${safeName(asset.fileName)}"` }), { expiresIn: ttl });
    return { assetId: asset.id, method: 'GET', url, headers: {}, expiresAt: expiresAt.toISOString(), fileName: asset.fileName, contentType: asset.contentType ?? 'application/octet-stream', byteSize: asset.byteSize?.toString() ?? '0', checksumSha256: asset.checksumSha256 };
  }

  async upload(asset: UploadAsset, leaseExpiresAt: Date, slot: string): Promise<UploadGrant> {
    const { client, bucket } = await this.connection(asset.bucket);
    const ttl = ttlSeconds(leaseExpiresAt);
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const checksum = asset.checksumSha256 ?? '';
    const headers = { 'content-type': asset.contentType ?? 'application/octet-stream', 'x-amz-meta-sha256': checksum, 'x-amz-meta-worker-slot': slot };
    const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: asset.objectKey, ContentType: headers['content-type'], ContentLength: asset.byteSize === null ? undefined : Number(asset.byteSize), Metadata: { sha256: checksum, 'worker-slot': slot } }), { expiresIn: ttl });
    const meta = asRecord(asset.metadata);
    return { assetId: asset.id, slot, method: 'PUT', url, headers, expiresAt: expiresAt.toISOString(), maxByteSize: String(meta.maxByteSize ?? asset.byteSize ?? 0) };
  }

  async verify(asset: UploadAsset): Promise<void> {
    const { client, bucket } = await this.connection(asset.bucket);
    let head;
    try { head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: asset.objectKey })); } catch { throw new WorkerError('ASSET_NOT_AVAILABLE', 'Uploaded object is not available'); }
    if (head.ContentLength !== (asset.byteSize === null ? undefined : Number(asset.byteSize)) || head.ContentType !== asset.contentType) throw new WorkerError('TASK_OUTPUT_INVALID', 'Uploaded object metadata does not match the grant');
    if (head.Metadata?.sha256 !== asset.checksumSha256) throw new WorkerError('ASSET_CHECKSUM_MISMATCH', 'Uploaded object checksum does not match the grant');
  }

  private async connection(assetBucket: string | null) {
    const row = await this.prisma.systemSetting.findUnique({ where: { singletonKey: 'DEFAULT' }, include: { storageCredential: true } });
    if (!row?.storageCredential || !row.storageAccountId || !row.storageBucket || assetBucket !== row.storageBucket) throw new WorkerError('ASSET_NOT_AVAILABLE', 'Object storage is not available');
    const credentials = this.cipher.decrypt<{ accessKeyId: string; secretAccessKey: string }>({ payload: row.storageCredential.encryptedPayload, keyVersion: row.storageCredential.keyVersion });
    return { bucket: row.storageBucket, client: new S3Client({ region: 'auto', endpoint: `https://${row.storageAccountId}.r2.cloudflarestorage.com`, credentials, forcePathStyle: true }) };
  }
}

function ttlSeconds(leaseExpiresAt: Date) { const remaining = Math.floor((leaseExpiresAt.valueOf() - Date.now()) / 1000); if (remaining < 1) throw new WorkerError('TASK_LEASE_EXPIRED', 'Task lease has expired'); return Math.min(300, remaining); }
function safeName(value: string) { return value.replace(/["\r\n\\]/gu, '_'); }
function asRecord(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
