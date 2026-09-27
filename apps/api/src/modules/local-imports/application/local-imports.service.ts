import { createHash } from 'node:crypto';
import type { LocalVideoImportResult, LocalVideoUploadRequest, UploadGrant } from '@reup-dubbing-studio/api-contract';

import { LocalImportError } from '../domain/local-import-errors';
import type { PrismaLocalImportRepository } from '../infrastructure/prisma-local-import-repository';
import type { R2LocalImportObjectStore } from '../infrastructure/r2-local-import-object-store';

export class LocalImportsService {
  constructor(
    private readonly repository: PrismaLocalImportRepository,
    private readonly objects: R2LocalImportObjectStore,
  ) {}

  async requestUpload(input: LocalVideoUploadRequest, idempotencyKey: string): Promise<UploadGrant> {
    validate(input);
    const target = await this.objects.target();
    const pending = await this.repository.createPending(input, target.bucket, idempotencyKey, hash(input));
    return this.objects.createUploadGrant(pending);
  }

  async refresh(assetId: string): Promise<UploadGrant> {
    return this.objects.createUploadGrant(await this.repository.getPending(assetId));
  }

  async commit(assetId: string, idempotencyKey: string): Promise<LocalVideoImportResult> {
    const requestHash = hash({ assetId });
    const replay = await this.repository.replayCommit(idempotencyKey, requestHash);
    if (replay) return replay;
    const pending = await this.repository.getPending(assetId);
    const inspected = await this.objects.inspect(pending);
    if (inspected.byteSize !== pending.byteSize || inspected.contentType !== pending.contentType) {
      throw new LocalImportError('LOCAL_IMPORT_NOT_AVAILABLE', 'Uploaded video metadata does not match the upload authorization');
    }
    if (inspected.checksumSha256 !== pending.checksumSha256) {
      throw new LocalImportError('LOCAL_IMPORT_NOT_AVAILABLE', 'Uploaded video checksum does not match the upload authorization');
    }
    return this.repository.commit(assetId, idempotencyKey, requestHash);
  }
}

function validate(input: LocalVideoUploadRequest): void {
  if (!input.title.trim()) fail('Video title is required');
  if (input.contentType !== 'video/mp4') fail('Only MP4 video is supported');
  if (!/^[a-f0-9]{64}$/u.test(input.checksumSha256)) fail('Video checksum must be SHA-256');
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(input.sourceLanguage)) fail('Invalid source language');
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 1 || input.byteSize > 10 * 1024 * 1024 * 1024) fail('Invalid video byte size');
}

function fail(message: string): never {
  throw new LocalImportError('LOCAL_IMPORT_VALIDATION_FAILED', message);
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
