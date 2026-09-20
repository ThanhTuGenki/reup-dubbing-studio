import type { AssetPart, GrantPurpose, LibraryFilters } from '../domain/library';
import type { PrismaLibraryRepository } from '../infrastructure/prisma-library-repository';
import type { R2LibraryObjectStore } from '../infrastructure/r2-library-object-store';

export class LibraryService {
  constructor(private readonly repository: PrismaLibraryRepository, private readonly objects: R2LibraryObjectStore) {}
  list(filters: LibraryFilters) { return this.repository.list(filters); }
  detail(id: string) { return this.repository.detail(id); }
  async grantAsset(videoId: string, linkId: string, purpose: GrantPurpose) { return this.grant(await this.repository.assetForGrant(videoId, linkId), purpose); }
  async grantOutput(videoId: string, outputId: string, part: AssetPart, purpose: GrantPurpose) { return this.grant(await this.repository.outputAssetForGrant(videoId, outputId, part), purpose); }
  private async grant(asset: Awaited<ReturnType<PrismaLibraryRepository['assetForGrant']>>, purpose: GrantPurpose) {
    const signed = await this.objects.createGrant(asset, purpose);
    return { data: { method: 'GET' as const, url: signed.url, expiresAt: signed.expiresAt.toISOString(), fileName: asset.fileName, contentType: asset.contentType, byteSize: asset.byteSize?.toString() ?? null } };
  }
}
