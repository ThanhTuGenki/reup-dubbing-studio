import type { ProfileAssetRepository, ProfileObjectStore } from '../../src/modules/profiles/application/asset-ports';
import { ProfileAssetsService } from '../../src/modules/profiles/application/profile-assets.service';

describe('ProfileAssetsService', () => {
  const pending = {
    id: '01994429-ec00-7000-8000-000000000010', role: 'MASK_REFERENCE_FRAME' as const,
    fileName: 'frame.webp', contentType: 'image/webp', byteSize: 100,
    width: 1920, height: 1080, bucket: 'media', objectKey: 'profiles/series/id/asset.webp',
  };
  const committed = {
    asset: {
      linkId: '01994429-ec00-7000-8000-000000000011', assetId: pending.id,
      role: pending.role, fileName: pending.fileName, contentType: pending.contentType,
      byteSize: '100', width: 1920, height: 1080, revision: 1,
    }, profileVersion: 2, parentVersion: 1,
  };
  let repository: jest.Mocked<ProfileAssetRepository>;
  let store: jest.Mocked<ProfileObjectStore>;
  let service: ProfileAssetsService;

  beforeEach(() => {
    repository = {
      createPending: jest.fn().mockResolvedValue(pending),
      getPending: jest.fn().mockResolvedValue(pending),
      getAvailable: jest.fn().mockResolvedValue(pending),
      replayCommit: jest.fn().mockResolvedValue(null),
      commit: jest.fn().mockResolvedValue(committed),
      detach: jest.fn(),
    };
    store = {
      target: jest.fn().mockResolvedValue({ bucket: 'media' }),
      createUploadGrant: jest.fn().mockResolvedValue({
        url: 'https://example.invalid/upload?signature=secret', headers: { 'Content-Type': 'image/webp' },
        expiresAt: new Date('2026-09-19T12:10:00.000Z'),
      }),
      createPreviewGrant: jest.fn().mockResolvedValue({
        url: 'https://example.invalid/preview?signature=secret',
        expiresAt: new Date('2026-09-19T12:05:00.000Z'),
      }),
      inspect: jest.fn().mockResolvedValue({ byteSize: 100, contentType: 'image/webp' }),
    };
    service = new ProfileAssetsService(repository, store);
  });

  it('creates a purpose-scoped upload grant for a normalized mask frame', async () => {
    const result = await service.requestUpload(
      { type: 'SERIES', id: '01994429-ec00-7000-8000-000000000012' },
      { role: 'MASK_REFERENCE_FRAME', fileName: 'frame.webp', contentType: 'image/webp', byteSize: 100, width: 1920, height: 1080 },
    );
    expect(result).toMatchObject({ assetId: pending.id, method: 'PUT', maxByteSize: 100 });
    expect(repository.createPending).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'media', 'webp');
  });

  it('rejects commit when R2 metadata differs from the authorization', async () => {
    store.inspect.mockResolvedValue({ byteSize: 99, contentType: 'image/webp' });
    await expect(service.commit(
      { type: 'SERIES', id: '01994429-ec00-7000-8000-000000000012' },
      pending.id, 1, 1, '01994429-ec00-7000-8000-000000000013',
    )).rejects.toMatchObject({ code: 'PROFILE_ASSET_NOT_AVAILABLE' });
    expect(repository.commit).not.toHaveBeenCalled();
  });

  it('commits only after the object metadata is verified', async () => {
    await expect(service.commit(
      { type: 'SERIES', id: '01994429-ec00-7000-8000-000000000012' },
      pending.id, 1, 1, '01994429-ec00-7000-8000-000000000013',
    )).resolves.toEqual(committed);
    expect(repository.commit).toHaveBeenCalledTimes(1);
  });

  it('replays a committed response without issuing another HEAD request', async () => {
    repository.replayCommit.mockResolvedValue(committed);
    await expect(service.commit(
      { type: 'SERIES', id: '01994429-ec00-7000-8000-000000000012' },
      pending.id, 1, 1, '01994429-ec00-7000-8000-000000000013',
    )).resolves.toEqual(committed);
    expect(store.inspect).not.toHaveBeenCalled();
    expect(repository.commit).not.toHaveBeenCalled();
  });

  it('returns a short-lived preview grant for the current asset link', async () => {
    await expect(service.preview(
      { type: 'SERIES', id: '01994429-ec00-7000-8000-000000000012' },
      '01994429-ec00-7000-8000-000000000011',
    )).resolves.toMatchObject({ assetId: pending.id, method: 'GET', contentType: 'image/webp' });
  });
});
