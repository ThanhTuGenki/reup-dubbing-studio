import { createHmac } from 'node:crypto';
import type { CommitOutputRequest, CompleteTaskRequest, FailTaskRequest, LeaseActionRequest, OutputGrantRequest, TaskProgressRequest } from '@reup-dubbing-studio/api-contract/worker';
import { WorkerError } from '../domain/worker-errors';
import type { PrismaWorkerTasksRepository } from '../infrastructure/prisma-worker-tasks-repository';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export class WorkerTasksService {
  constructor(private readonly repository: PrismaWorkerTasksRepository, private readonly secret: string) {}
  claim(credential: string, sessionId: string) { return this.repository.claim(credential.slice(0, 12), this.hash(credential), uuid(sessionId)); }
  start(credential: string, taskId: string, attemptId: string, input: LeaseActionRequest, key: string) { ids(taskId, attemptId, input.leaseId); return this.repository.idempotent(`WORKER_TASK_START_V1:${taskId}:${attemptId}`, key, input, () => this.repository.start(credential.slice(0, 12), this.hash(credential), taskId, attemptId, input.leaseId, fence(input.fencingToken))); }
  renew(credential: string, taskId: string, attemptId: string, input: LeaseActionRequest, key: string) { ids(taskId, attemptId, input.leaseId); return this.repository.idempotent(`WORKER_TASK_RENEW_V1:${taskId}:${attemptId}`, key, input, () => this.repository.renew(credential.slice(0, 12), this.hash(credential), taskId, attemptId, input.leaseId, fence(input.fencingToken))); }
  progress(credential: string, taskId: string, attemptId: string, input: TaskProgressRequest, key: string) { ids(taskId, attemptId, input.leaseId); return this.repository.idempotent(`WORKER_TASK_PROGRESS_V1:${taskId}:${attemptId}`, key, input, () => this.repository.progress(credential.slice(0, 12), this.hash(credential), taskId, attemptId, input)); }
  inputGrant(credential: string, taskId: string, attemptId: string, assetId: string, input: LeaseActionRequest) { ids(taskId, attemptId, assetId, input.leaseId); return this.repository.inputGrant(credential.slice(0, 12), this.hash(credential), taskId, attemptId, assetId, input.leaseId, fence(input.fencingToken)); }
  createOutput(credential: string, taskId: string, attemptId: string, input: OutputGrantRequest) { ids(taskId, attemptId, input.leaseId); return this.repository.createOutput(credential.slice(0, 12), this.hash(credential), taskId, attemptId, input); }
  refreshOutput(credential: string, taskId: string, attemptId: string, assetId: string, input: LeaseActionRequest) { ids(taskId, attemptId, assetId, input.leaseId); return this.repository.refreshOutput(credential.slice(0, 12), this.hash(credential), taskId, attemptId, assetId, input.leaseId, fence(input.fencingToken)); }
  commitOutput(credential: string, taskId: string, attemptId: string, assetId: string, input: CommitOutputRequest, key: string) { ids(taskId, attemptId, assetId, input.leaseId); return this.repository.idempotent(`WORKER_TASK_OUTPUT_COMMIT_V1:${taskId}:${attemptId}:${assetId}`, key, input, () => this.repository.commitOutput(credential.slice(0, 12), this.hash(credential), taskId, attemptId, assetId, input)); }
  complete(credential: string, taskId: string, attemptId: string, input: CompleteTaskRequest, key: string) { ids(taskId, attemptId, input.leaseId); return this.repository.idempotent(`WORKER_TASK_COMPLETE_V1:${taskId}:${attemptId}`, key, input, () => this.repository.complete(credential.slice(0, 12), this.hash(credential), taskId, attemptId, input)); }
  fail(credential: string, taskId: string, attemptId: string, input: FailTaskRequest, key: string) { ids(taskId, attemptId, input.leaseId); return this.repository.idempotent(`WORKER_TASK_FAIL_V1:${taskId}:${attemptId}`, key, input, () => this.repository.fail(credential.slice(0, 12), this.hash(credential), taskId, attemptId, input)); }
  private hash(value: string) { return createHmac('sha256', Buffer.from(this.secret, 'base64')).update(`worker:v1:${value}`).digest('hex'); }
}
function uuid(value: string) { if (!UUID_V7.test(value)) throw new WorkerError('WORKER_VALIDATION_FAILED', 'ID must be UUID v7'); return value; }
function ids(...values: string[]) { values.forEach(uuid); }
function fence(value: string) { try { const parsed = BigInt(value); if (parsed < 1n) throw new Error(); return parsed; } catch { throw new WorkerError('WORKER_VALIDATION_FAILED', 'Fencing token is invalid'); } }
