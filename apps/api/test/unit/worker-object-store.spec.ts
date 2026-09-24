import { S3Client } from '@aws-sdk/client-s3';
import { AesGcmCredentialCipher } from '../../src/modules/settings';
import { R2WorkerObjectStore } from '../../src/modules/workers/infrastructure/r2-worker-object-store';

describe('Worker output object verification', () => {
  const asset = { id: '0191f3d2-7f5b-7abc-8b2e-123456789b09', bucket: 'worker-test', objectKey: 'worker/output.mp4', fileName: 'output.mp4', contentType: 'video/mp4', byteSize: 7n, checksumSha256: 'a'.repeat(64), metadata: {} };
  afterEach(() => jest.restoreAllMocks());

  it('accepts HEAD metadata only when size, content type and checksum match', async () => {
    const { store } = fixture();
    jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({ ContentLength: 7, ContentType: 'video/mp4', Metadata: { sha256: 'a'.repeat(64) } } as never);

    await expect(store.verify(asset)).resolves.toBeUndefined();
  });

  it('rejects a remotely stored object with a different checksum', async () => {
    const { store } = fixture();
    jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({ ContentLength: 7, ContentType: 'video/mp4', Metadata: { sha256: 'b'.repeat(64) } } as never);

    await expect(store.verify(asset)).rejects.toMatchObject({ code: 'ASSET_CHECKSUM_MISMATCH' });
  });

  function fixture() {
    const cipher = new AesGcmCredentialCipher(Buffer.alloc(32, 8).toString('base64'));
    const encrypted = cipher.encrypt({ accessKeyId: 'test-access', secretAccessKey: 'test-secret' });
    const prisma = { systemSetting: { findUnique: jest.fn().mockResolvedValue({ storageAccountId: 'test', storageBucket: 'worker-test', storageCredential: { encryptedPayload: encrypted.payload, keyVersion: encrypted.keyVersion } }) } };
    return { store: new R2WorkerObjectStore(prisma as never, cipher) };
  }
});
