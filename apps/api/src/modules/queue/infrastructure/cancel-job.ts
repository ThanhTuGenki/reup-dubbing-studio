import type { Prisma } from '@prisma/client';

import { uuidV7 } from '../../../platform/ids/uuid-v7';

const OWNER_ID = '01994429-ec00-7000-8000-000000000002';
export const ACTIVE_JOB_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_FOR_GPU', 'WAITING_FOR_REVIEW'] as const;
type EventJob = { id: string; videoId: string; status: string; version: number };

/**
 * Cancels one active job inside the caller's transaction. Tasks stop, leases are released and
 * STARTED attempts become CANCELLED, so a worker's late progress/complete gets STALE_TASK_ATTEMPT.
 * Returns false when the job is missing or no longer active.
 */
export async function cancelJobInTransaction(tx: Prisma.TransactionClient, jobId: string, reason: string | null, requestId?: string): Promise<boolean> {
  const job = await tx.pipelineJob.findUnique({ where: { id: jobId }, select: { id: true, videoId: true, status: true, version: true } });
  if (!job || !ACTIVE_JOB_STATUSES.includes(job.status as typeof ACTIVE_JOB_STATUSES[number])) return false;
  const now = new Date();
  await tx.pipelineTask.updateMany({ where: { pipelineJobId: jobId, status: { notIn: ['SUCCEEDED', 'CANCELLED'] } }, data: { status: 'CANCELLED', version: { increment: 1 } } });
  await tx.taskLease.updateMany({ where: { pipelineTask: { pipelineJobId: jobId }, releasedAt: null }, data: { releasedAt: now, releaseReason: 'JOB_CANCELLED' } });
  await tx.taskAttempt.updateMany({ where: { pipelineTask: { pipelineJobId: jobId }, status: 'STARTED' }, data: { status: 'CANCELLED', finishedAt: now } });
  await tx.pipelineJob.update({ where: { id: jobId }, data: { status: 'CANCELLED', finishedAt: now, version: { increment: 1 } } });
  await recordJobEvent(tx, job, 'JOB_CANCELLED', 'CANCELLED', reason, requestId);
  return true;
}

export async function recordJobEvent(tx: Prisma.TransactionClient, job: EventJob, eventType: string, toStatus: string, message: string | null, requestId?: string, taskId?: string): Promise<void> {
  await tx.workflowEvent.create({ data: { id: uuidV7(), videoId: job.videoId, pipelineJobId: job.id, pipelineTaskId: taskId ?? null, eventType, fromStatus: job.status, toStatus, actorType: 'USER', actorId: OWNER_ID, messageSafe: message, payloadSafe: {} } });
  await tx.auditEvent.create({ data: { id: uuidV7(), actorType: 'USER', actorId: OWNER_ID, action: eventType, entityType: 'PIPELINE_JOB', entityId: job.id, requestId: requestId ?? null, beforeSafe: { status: job.status, version: job.version }, afterSafe: { status: toStatus, version: job.version + 1 }, metadataSafe: { reason: message, taskId: taskId ?? null } } });
  await tx.outboxMessage.create({ data: { id: uuidV7(), aggregateType: 'PIPELINE_JOB', aggregateId: job.id, eventType: 'queue.invalidate', payloadSafe: { entity: 'JOB', jobId: job.id, jobVersion: job.version + 1, reason: eventType } } });
}
