import { AesGcmCredentialCipher } from '../../src/modules/settings';
import { R2LibraryObjectStore } from '../../src/modules/library/infrastructure/r2-library-object-store';

describe('Library presigned grants', () => {
  it('creates a short-lived resource-scoped GET URL without persisting it', async () => {
    const cipher = new AesGcmCredentialCipher(Buffer.alloc(32, 8).toString('base64'));
    const encrypted = cipher.encrypt({ accessKeyId: 'test-access', secretAccessKey: 'test-secret' });
    const prisma = { systemSetting: { findUnique: jest.fn().mockResolvedValue({ storageAccountId: 'account', storageBucket: 'library-bucket', storageCredential: { encryptedPayload: encrypted.payload, keyVersion: encrypted.keyVersion } }) } };
    const store = new R2LibraryObjectStore(prisma as never, cipher);
    const result = await store.createGrant({ bucket: 'library-bucket', objectKey: 'videos/safe/output.mp4', fileName: 'output.mp4', contentType: 'video/mp4', byteSize: 12n }, 'download');
    expect(result.url).toContain('videos/safe/output.mp4'); expect(result.url).toContain('X-Amz-Expires=300'); expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now()); expect(prisma.systemSetting.findUnique).toHaveBeenCalledTimes(1);
  });
  it('refuses an asset outside the configured bucket', async () => {
    const cipher = new AesGcmCredentialCipher(Buffer.alloc(32, 8).toString('base64')); const encrypted = cipher.encrypt({ accessKeyId: 'id', secretAccessKey: 'secret' });
    const prisma = { systemSetting: { findUnique: jest.fn().mockResolvedValue({ storageAccountId: 'account', storageBucket: 'expected', storageCredential: { encryptedPayload: encrypted.payload, keyVersion: 1 } }) } };
    await expect(new R2LibraryObjectStore(prisma as never, cipher).createGrant({ bucket: 'other', objectKey: 'private', fileName: 'x', contentType: null, byteSize: null }, 'preview')).rejects.toMatchObject({ code: 'LIBRARY_ASSET_NOT_AVAILABLE' });
  });
});
