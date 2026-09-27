import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { CreateImageInput, CreateWorkerInput, EnrollmentInput, HeartbeatInput, WorkerFilters } from '../domain/workers';
import { WorkerError } from '../domain/worker-errors';
import type { PrismaWorkersRepository } from '../infrastructure/prisma-workers-repository';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export class WorkersService {
  constructor(private readonly repository: PrismaWorkersRepository, private readonly secret: string) {}
  list(filters: WorkerFilters) { validateFilters(filters); return this.repository.list(filters); }
  detail(id: string) { return this.repository.detail(uuid(id)); }
  images() { return this.repository.images(); }
  createImage(input: CreateImageInput, key: string) { validateImage(input); return this.repository.createImage(input, idem(key), hash(input)); }
  revokeImage(id: string, version: number, key: string) { return this.repository.revokeImage(uuid(id), version, idem(key)); }
  create(input: CreateWorkerInput, key: string) { validateWorker(input); const token = secretToken('enr'); return this.repository.create(input, idem(key), hash(input), token, this.tokenHash(token)); }
  issueToken(id: string, version: number, key: string) { const token = secretToken('enr'); return this.repository.issueToken(uuid(id), version, idem(key), token, this.tokenHash(token)); }
  drain(id: string, version: number, key: string) { return this.repository.drain(uuid(id), version, idem(key)); }
  revoke(id: string, version: number, key: string) { return this.repository.revoke(uuid(id), version, idem(key)); }
  confirmTermination(id: string, version: number, key: string) { return this.repository.confirmTermination(uuid(id), version, idem(key)); }
  enroll(token: string, input: EnrollmentInput) { validateEnrollment(input); const credential = secretToken('wrk'); return this.repository.enroll(token.slice(0, 12), this.tokenHash(token), input, credential, this.tokenHash(credential)); }
  startSession(credential: string, input: EnrollmentInput) { validateEnrollment(input); return this.repository.startSession(credential.slice(0, 12), this.tokenHash(credential), input); }
  heartbeat(credential: string, sessionId: string, input: HeartbeatInput) { validateHeartbeat(input); return this.repository.heartbeat(credential.slice(0, 12), this.tokenHash(credential), uuid(sessionId), input); }
  events() { return this.repository.events(); }
  private tokenHash(value: string) { return createHmac('sha256', Buffer.from(this.secret, 'base64')).update(`worker:v1:${value}`).digest('hex'); }
}
function uuid(value: string) { if (!UUID_V7.test(value)) throw new WorkerError('WORKER_VALIDATION_FAILED', 'ID must be UUID v7'); return value; }
function idem(value: string) { if (!/^[\x21-\x7e]{8,128}$/u.test(value)) throw new WorkerError('WORKER_VALIDATION_FAILED', 'Idempotency-Key must contain 8 to 128 visible ASCII characters'); return value; }
function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function secretToken(prefix: string) { return `${prefix}_${randomBytes(32).toString('base64url')}`; }
const CAPABILITY = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+\.v[1-9][0-9]*$/u;
const ROLE_CAPABILITIES: Record<CreateImageInput['role'], Set<string>> = {
  BATCH_MEDIA: new Set(['media.desub.v1', 'transcript.asr.v1', 'audio.separate.demucs.v1', 'media.render.ffmpeg.v1']),
  INTERACTIVE_TTS: new Set(['tts.omnivoice.v1']),
};
function validateImage(input: CreateImageInput) { const unique = new Set(input.capabilities); if (!/^sha256:[a-f0-9]{64}$/u.test(input.imageDigest) || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(input.semanticVersion) || input.contractVersion < 1 || !input.capabilities.length || unique.size !== input.capabilities.length || input.capabilities.some((item) => !CAPABILITY.test(item) || !ROLE_CAPABILITIES[input.role].has(item))) throw new WorkerError('WORKER_VALIDATION_FAILED', 'Worker image metadata is invalid'); }
function validateWorker(input: CreateWorkerInput) { uuid(input.approvedImageId); if (!input.displayName.trim() || !input.provider.trim() || Number(input.hourlyRateCp) < 0 || (input.expectedVramMb !== undefined && input.expectedVramMb < 0) || Number.isNaN(new Date(input.billingStartedAt).valueOf())) throw new WorkerError('WORKER_VALIDATION_FAILED', 'Worker configuration is invalid'); }
function validateEnrollment(input: EnrollmentInput) { uuid(input.sessionNonce); const unique = new Set(input.capabilities); if (!/^sha256:[a-f0-9]{64}$/u.test(input.imageDigest) || input.contractVersion < 1 || !input.agentVersion.trim() || !input.capabilities.length || unique.size !== input.capabilities.length || input.capabilities.some((item) => !CAPABILITY.test(item)) || input.capacity.availableTaskSlots > input.capacity.maxConcurrentTasks) throw new WorkerError('WORKER_VALIDATION_FAILED', 'Enrollment identity is invalid'); }
function validateHeartbeat(input: HeartbeatInput) { let sequence: bigint; try { sequence = BigInt(input.sequence); } catch { throw new WorkerError('WORKER_VALIDATION_FAILED', 'Heartbeat sequence is invalid'); } if (sequence < 0n || input.currentTaskCount < 0 || input.capacity.availableTaskSlots > input.capacity.maxConcurrentTasks || Number.isNaN(new Date(input.sentAt).valueOf())) throw new WorkerError('WORKER_VALIDATION_FAILED', 'Heartbeat payload is invalid'); input.activeLeaseIds.forEach(uuid); }
function validateFilters(filters: WorkerFilters) { if (filters.role && !['BATCH_MEDIA', 'INTERACTIVE_TTS'].includes(filters.role) || filters.observedStatus && !['PENDING', 'READY', 'BUSY', 'DRAINING', 'SAFE_TO_TERMINATE', 'OFFLINE', 'TERMINATED', 'ERROR'].includes(filters.observedStatus) || filters.desiredStatus && !['ACTIVE', 'DRAINING', 'REVOKED'].includes(filters.desiredStatus)) throw new WorkerError('WORKER_VALIDATION_FAILED', 'Worker filter is invalid'); }
