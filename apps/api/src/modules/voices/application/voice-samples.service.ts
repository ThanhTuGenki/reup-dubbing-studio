import { createHash } from 'node:crypto';
import type { ProfileObjectStore } from '../../profiles/application/asset-ports';
import { ProfileError } from '../../profiles/domain/profile-errors';
import type { VoiceSampleRepository } from './ports';
import { VoiceError } from '../domain/voice-errors';
import type { RequestVoiceSampleUpload } from '../domain/voices';
import { language } from './voices.service';

const TYPES: Record<string, string> = { 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/mpeg': 'mp3', 'audio/webm': 'webm' };
export class VoiceSamplesService {
  constructor(private readonly repository: VoiceSampleRepository, private readonly store: ProfileObjectStore) {}
  async requestUpload(voiceId: string, input: RequestVoiceSampleUpload) {
    validate(input); const target = await storage(() => this.store.target());
    const asset = await this.repository.createPending(voiceId, input, target.bucket, TYPES[input.contentType]!);
    return this.grant(asset);
  }
  async refresh(voiceId: string, assetId: string) { return this.grant(await this.repository.getPending(voiceId, assetId)); }
  async preview(voiceId: string, sampleId: string) {
    const asset = await this.repository.getAvailable(voiceId, sampleId); const grant = await storage(() => this.store.createPreviewGrant(asset));
    return { assetId: asset.id, method: 'GET' as const, url: grant.url, expiresAt: grant.expiresAt.toISOString(), fileName: asset.fileName, contentType: asset.contentType, byteSize: asset.byteSize };
  }
  async commit(voiceId: string, assetId: string, version: number, key: string) {
    const hash = createHash('sha256').update(`${voiceId}:${assetId}:${version}`).digest('hex');
    const replay = await this.repository.replayCommit(voiceId, key, hash); if (replay) return replay;
    const asset = await this.repository.getPending(voiceId, assetId); const inspected = await storage(() => this.store.inspect(asset));
    if (inspected.byteSize !== asset.byteSize || inspected.contentType !== asset.contentType) throw new VoiceError('VOICE_SAMPLE_NOT_AVAILABLE', 'Uploaded sample metadata does not match the authorization');
    return this.repository.commit(voiceId, assetId, version, key, hash);
  }
  detach(voiceId: string, sampleId: string, version: number) { return this.repository.detach(voiceId, sampleId, version); }
  private async grant(asset: Awaited<ReturnType<VoiceSampleRepository['getPending']>>) { const grant = await storage(() => this.store.createUploadGrant(asset)); return { assetId: asset.id, method: 'PUT' as const, url: grant.url, headers: grant.headers, expiresAt: grant.expiresAt.toISOString(), maxByteSize: asset.byteSize }; }
}
function validate(input: RequestVoiceSampleUpload) {
  if (!language(input.language)) fail('Invalid sample language'); if (!input.transcript.trim() || input.transcript.length > 1000) fail('Invalid sample transcript');
  if (!Number.isInteger(input.durationMs) || input.durationMs < 3000 || input.durationMs > 10000) fail('Sample duration must be between 3 and 10 seconds');
  if (!TYPES[input.contentType]) fail('Unsupported sample content type'); if (!Number.isInteger(input.byteSize) || input.byteSize < 1 || input.byteSize > 15 * 1024 * 1024) fail('Invalid sample byte size');
  if (!input.fileName.trim() || input.fileName.length > 255) fail('Invalid sample file name');
  if (input.checksumSha256 !== undefined && !/^[0-9a-f]{64}$/u.test(input.checksumSha256)) fail('Invalid sample checksum');
}
function fail(message: string): never { throw new VoiceError('VOICE_VALIDATION_FAILED', message); }
async function storage<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch (error) {
    if (error instanceof ProfileError) throw new VoiceError('VOICE_SAMPLE_NOT_AVAILABLE', error.message);
    throw error;
  }
}
