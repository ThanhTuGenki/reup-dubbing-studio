import type { PublicationChecklistStatus } from '@prisma/client';
import type { PrismaPublishingRepository } from '../infrastructure/prisma-publishing-repository';
import type { R2LibraryObjectStore } from '../../library/infrastructure/r2-library-object-store';
import type { CreatePackageInput, ProofInput, ProofVerificationInput, PublicationAssetRole, PublicationFilters, PublicationPlanInput } from '../domain/publishing';

export class PublishingService {
  constructor(private readonly repository: PrismaPublishingRepository, private readonly objects: R2LibraryObjectStore) {}
  list(filters: PublicationFilters) { return this.repository.list(filters); }
  package(id: string) { return this.repository.package(id); }
  task(id: string) { return this.repository.task(id); }
  createPackage(videoId: string, input: CreatePackageInput, key: string) { return this.repository.createPackage(videoId, input, key); }
  updateField(taskId: string, key: string, value: string, version: number) { return this.repository.updateField(taskId, key, value, version); }
  lockField(taskId: string, key: string, isLocked: boolean, version: number) { return this.repository.lockField(taskId, key, isLocked, version); }
  approve(taskId: string, version: number, key: string) { return this.repository.approve(taskId, version, key); }
  plan(taskId: string, version: number, input: PublicationPlanInput) { return this.repository.plan(taskId, version, input); }
  checklist(taskId: string, itemKey: string, status: PublicationChecklistStatus, version: number) { return this.repository.checklist(taskId, itemKey, status, version); }
  start(taskId: string, version: number, key: string) { return this.repository.start(taskId, version, key); }
  proof(taskId: string, version: number, input: ProofInput, key: string) { return this.repository.proof(taskId, version, input, key); }
  verify(taskId: string, proofId: string, version: number, input: ProofVerificationInput, key: string) { return this.repository.verify(taskId, proofId, version, input, key); }
  requestRevision(taskId: string, version: number, key: string) { return this.repository.requestRevision(taskId, version, key); }
  generate(): never { return this.repository.contentAgentUnavailable(); }
  regenerate(): never { return this.repository.contentAgentUnavailable(); }
  async download(taskId: string, role: PublicationAssetRole) {
    const asset = await this.repository.asset(taskId, role);
    const signed = await this.objects.createGrant(asset, 'download');
    return { method: 'GET' as const, url: signed.url, expiresAt: signed.expiresAt.toISOString(), fileName: asset.fileName, contentType: asset.contentType, byteSize: asset.byteSize?.toString() ?? null };
  }
}
