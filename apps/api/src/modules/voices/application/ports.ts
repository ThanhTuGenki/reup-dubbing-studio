import type { CreateVoiceProfile, PendingVoiceSample, RequestVoiceSampleUpload, UpdateVoiceProfile, VoiceList, VoiceListQuery, VoiceProfileView } from '../domain/voices';

export interface VoiceRepository {
  list(query: VoiceListQuery): Promise<VoiceList>;
  get(id: string): Promise<VoiceProfileView>;
  create(input: CreateVoiceProfile, key: string, hash: string): Promise<VoiceProfileView>;
  update(id: string, version: number, input: UpdateVoiceProfile): Promise<VoiceProfileView>;
  activate(id: string, version: number): Promise<VoiceProfileView>;
  archive(id: string, version: number): Promise<VoiceProfileView>;
  restore(id: string, version: number): Promise<VoiceProfileView>;
}

export interface VoiceSampleRepository {
  createPending(voiceId: string, input: RequestVoiceSampleUpload, bucket: string, extension: string): Promise<PendingVoiceSample>;
  getPending(voiceId: string, assetId: string): Promise<PendingVoiceSample>;
  getAvailable(voiceId: string, sampleId: string): Promise<PendingVoiceSample>;
  replayCommit(voiceId: string, key: string, hash: string): Promise<{ sample: unknown; profileVersion: number } | null>;
  commit(voiceId: string, assetId: string, version: number, key: string, hash: string): Promise<{ sample: unknown; profileVersion: number }>;
  detach(voiceId: string, sampleId: string, version: number): Promise<{ profileVersion: number }>;
}
