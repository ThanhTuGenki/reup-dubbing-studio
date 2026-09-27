import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { AesGcmCredentialCipher } from '../../src/modules/settings';
import { R2VideoDeletionObjectStore } from '../../src/modules/video-deletion/infrastructure/r2-video-deletion-object-store';

describe('R2VideoDeletionObjectStore', () => {
  const cipher = new AesGcmCredentialCipher(Buffer.alloc(32, 8).toString('base64'));
  const encrypted = cipher.encrypt({ accessKeyId: 'id', secretAccessKey: 'secret' });
  const settings = (bucket: string | null = 'bucket') => ({ systemSetting: { findUnique: jest.fn().mockResolvedValue(bucket ? { storageAccountId: 'account', storageBucket: bucket, storageCredential: { encryptedPayload: encrypted.payload, keyVersion: encrypted.keyVersion } } : null) } });
  afterEach(() => jest.restoreAllMocks());

  it('deletes exactly the given bucket and key', async () => {
    const send = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    await new R2VideoDeletionObjectStore(settings() as never, cipher).deleteObject('bucket', 'videos/v/raw.mp4');
    const command = send.mock.calls[0]![0] as DeleteObjectCommand;
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toEqual({ Bucket: 'bucket', Key: 'videos/v/raw.mp4' });
  });

  it('treats a missing object as already deleted', async () => {
    jest.spyOn(S3Client.prototype, 'send').mockRejectedValue(Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } }) as never);
    await expect(new R2VideoDeletionObjectStore(settings() as never, cipher).deleteObject('bucket', 'gone')).resolves.toBeUndefined();
  });

  it('maps configuration and storage failures to safe codes', async () => {
    await expect(new R2VideoDeletionObjectStore(settings(null) as never, cipher).deleteObject('bucket', 'k')).rejects.toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' });
    await expect(new R2VideoDeletionObjectStore(settings('other') as never, cipher).deleteObject('bucket', 'k')).rejects.toMatchObject({ code: 'STORAGE_BUCKET_MISMATCH' });
    jest.spyOn(S3Client.prototype, 'send').mockRejectedValue(Object.assign(new Error('https://account.r2.cloudflarestorage.com/secret'), { $metadata: { httpStatusCode: 500 } }) as never);
    const failure = new R2VideoDeletionObjectStore(settings() as never, cipher).deleteObject('bucket', 'k');
    await expect(failure).rejects.toMatchObject({ code: 'STORAGE_DELETE_FAILED' });
    await expect(failure).rejects.not.toMatchObject({ message: expect.stringContaining('r2.cloudflarestorage.com') });
  });
});
