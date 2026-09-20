import type { Prisma, PrismaClient } from '@prisma/client';
import { uuidV7 } from '../../../platform/ids/uuid-v7';
import type { VoiceSampleRepository } from '../application/ports';
import { VoiceError } from '../domain/voice-errors';
import type { PendingVoiceSample, RequestVoiceSampleUpload } from '../domain/voices';

export class PrismaVoiceSampleRepository implements VoiceSampleRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async createPending(voiceId: string, input: RequestVoiceSampleUpload, bucket: string, extension: string) {
    await editable(this.prisma, voiceId);
    const id = uuidV7();
    const row = await this.prisma.asset.create({ data: {
      id, storageBackend: 'R2', bucket, objectKey: `voices/${voiceId}/${id}.${extension}`,
      fileName: input.fileName.trim(), byteSize: BigInt(input.byteSize), contentType: input.contentType,
      ...(input.checksumSha256 ? { checksumSha256: input.checksumSha256 } : {}),
      metadata: { ownerType: 'VOICE', ownerId: voiceId, role: 'VOICE_REFERENCE_SAMPLE', language: input.language, transcript: input.transcript, durationMs: input.durationMs },
    } });
    return pending(row);
  }
  async getPending(voiceId: string, assetId: string) {
    const row = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!row || row.status !== 'PENDING' || !owned(row.metadata, voiceId)) unavailable();
    return pending(row);
  }
  async getAvailable(voiceId: string, sampleId: string) {
    const link = await this.prisma.voiceProfileSample.findUnique({ where: { id: sampleId }, include: { asset: true } });
    if (!link || link.voiceProfileId !== voiceId || !link.isCurrent || link.asset.status !== 'AVAILABLE') unavailable();
    return pending(link.asset);
  }
  async replayCommit(voiceId: string, key: string, hash: string) {
    const row = await this.prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope: 'COMMIT_VOICE_SAMPLE', key } } });
    if (!row) return null; if (row.requestHash !== hash) invalid('Idempotency key was used for another request');
    return row.responseBody as { sample: unknown; profileVersion: number };
  }
  async commit(voiceId: string, assetId: string, version: number, key: string, hash: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const previous = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope: 'COMMIT_VOICE_SAMPLE', key } } });
        if (previous) { if (previous.requestHash !== hash) invalid('Idempotency key was used for another request'); return previous.responseBody as { sample: unknown; profileVersion: number }; }
        const voice = await tx.voiceProfile.findUnique({ where: { id: voiceId } });
        if (!voice) throw new VoiceError('VOICE_NOT_FOUND', 'Voice profile was not found');
        if (voice.status === 'ARCHIVED') throw new VoiceError('VOICE_ARCHIVED', 'Archived voice cannot accept samples');
        if (voice.version !== version) conflict();
        const asset = await tx.asset.findUnique({ where: { id: assetId } });
        if (!asset || asset.status !== 'PENDING' || !owned(asset.metadata, voiceId)) unavailable();
        const meta = metadata(asset.metadata); const language = String(meta.language); const transcript = String(meta.transcript); const durationMs = Number(meta.durationMs);
        const latest = await tx.voiceProfileSample.aggregate({ where: { voiceProfileId: voiceId, language }, _max: { revision: true } });
        await tx.voiceProfileSample.updateMany({ where: { voiceProfileId: voiceId, language, isCurrent: true }, data: { isCurrent: false } });
        const link = await tx.voiceProfileSample.create({ data: { id: uuidV7(), voiceProfileId: voiceId, assetId, language, transcript, durationMs, revision: (latest._max.revision ?? 0) + 1 } });
        await tx.asset.update({ where: { id: assetId }, data: { status: 'AVAILABLE', uploadedAt: new Date(), verifiedAt: new Date(), version: { increment: 1 } } });
        const updated = await tx.voiceProfile.update({ where: { id: voiceId }, data: { version: { increment: 1 }, ...(voice.status === 'READY' ? { status: 'DRAFT' as const } : {}) } });
        const result = { sample: { id: link.id, assetId, language, transcript, durationMs, revision: link.revision }, profileVersion: updated.version };
        await tx.idempotencyRecord.create({ data: { id: uuidV7(), scope: 'COMMIT_VOICE_SAMPLE', key, requestHash: hash, responseBody: result, responseEtag: `"${updated.version}"` } });
        return result;
      });
    } catch (error) { const replay = await this.replayCommit(voiceId, key, hash); if (replay) return replay; throw error; }
  }
  detach(voiceId: string, sampleId: string, version: number) {
    return this.prisma.$transaction(async (tx) => {
      const voice = await tx.voiceProfile.findUnique({ where: { id: voiceId } });
      if (!voice) throw new VoiceError('VOICE_NOT_FOUND', 'Voice profile was not found'); if (voice.version !== version) conflict();
      if (voice.status === 'READY') throw new VoiceError('VOICE_NOT_READY', 'Move voice to draft or replace the sample before detaching it');
      const link = await tx.voiceProfileSample.findUnique({ where: { id: sampleId } });
      if (!link || link.voiceProfileId !== voiceId || !link.isCurrent) unavailable();
      await tx.voiceProfileSample.update({ where: { id: sampleId }, data: { isCurrent: false } });
      const updated = await tx.voiceProfile.update({ where: { id: voiceId }, data: { version: { increment: 1 } } });
      return { profileVersion: updated.version };
    });
  }
}
type AssetRow = Awaited<ReturnType<PrismaClient['asset']['findUniqueOrThrow']>>;
function pending(row: AssetRow): PendingVoiceSample {
  if (row.bucket === null || row.contentType === null || row.byteSize === null) unavailable(); const meta = metadata(row.metadata);
  return { id: row.id, bucket: row.bucket, objectKey: row.objectKey, fileName: row.fileName, contentType: row.contentType,
    byteSize: Number(row.byteSize), language: String(meta.language), transcript: String(meta.transcript), durationMs: Number(meta.durationMs),
    ...(row.checksumSha256 ? { checksumSha256: row.checksumSha256 } : {}) };
}
async function editable(client: PrismaClient, id: string) { const row = await client.voiceProfile.findUnique({ where: { id } }); if (!row) throw new VoiceError('VOICE_NOT_FOUND', 'Voice profile was not found'); if (row.status === 'ARCHIVED') throw new VoiceError('VOICE_ARCHIVED', 'Archived voice cannot accept samples'); }
function metadata(value: Prisma.JsonValue) { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {}; }
function owned(value: Prisma.JsonValue, voiceId: string) { const meta = metadata(value); return meta.ownerType === 'VOICE' && meta.ownerId === voiceId; }
function unavailable(): never { throw new VoiceError('VOICE_SAMPLE_NOT_AVAILABLE', 'Voice sample was not found or is no longer current'); }
function conflict(): never { throw new VoiceError('VOICE_VERSION_CONFLICT', 'Voice changed since it was loaded'); }
function invalid(message: string): never { throw new VoiceError('VOICE_VALIDATION_FAILED', message); }
