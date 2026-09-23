import { Prisma, type PrismaClient } from '@prisma/client';
import type { Dashboard, DashboardActivityItem, DashboardAttentionItem, DashboardVideoCounts } from '@reup-dubbing-studio/api-contract';

const VIDEO_STATUSES = ['INGEST_QUEUED', 'INGESTING', 'INGESTED', 'PROCESSING', 'AWAITING_REVIEW', 'READY_TO_PUBLISH', 'PUBLISHED', 'FAILED', 'ARCHIVED'] as const;
const ACTIVE_JOBS = ['QUEUED', 'RUNNING', 'WAITING_FOR_GPU', 'WAITING_FOR_REVIEW'] as const;
const ONLINE_WORKERS = ['READY', 'BUSY', 'DRAINING', 'SAFE_TO_TERMINATE'] as const;
const OPEN_PUBLICATION = ['READY_FOR_CONTENT', 'CONTENT_GENERATED', 'CONTENT_APPROVED', 'READY_TO_PUBLISH', 'POSTING_MANUAL', 'NEEDS_REVISION'] as const;

export class PrismaDashboardRepository {
  constructor(private readonly prisma: PrismaClient, private readonly clock: () => Date = () => new Date()) {}

  async get(): Promise<Dashboard> {
    const now = this.clock();
    const upcomingUntil = new Date(now.valueOf() + 7 * 24 * 60 * 60 * 1000);
    const credentialWarningAt = new Date(now.valueOf() + 72 * 60 * 60 * 1000);
    const waitingGpuBefore = new Date(now.valueOf() - 15 * 60 * 1000);

    const [videoGroups, jobGroups, publicationGroups, workerGroups, upcoming, overdue, activeLeases, billing, failedJobs, waitingGpuJobs, overdueTasks, revisionTasks, workers, sourceAccounts, workflowEvents, auditEvents, proofs] = await Promise.all([
      this.prisma.video.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.pipelineJob.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.publicationTask.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.worker.groupBy({ by: ['observedStatus'], _count: { _all: true }, where: { observedStatus: { not: 'TERMINATED' } } }),
      this.prisma.publicationTask.count({ where: { status: { in: [...OPEN_PUBLICATION] }, scheduledAt: { gte: now, lte: upcomingUntil } } }),
      this.prisma.publicationTask.count({ where: { status: { notIn: ['PUBLISHED', 'VERIFIED', 'CANCELLED'] }, deadlineAt: { lt: now } } }),
      this.prisma.taskLease.count({ where: { releasedAt: null, workerSession: { endedAt: null } } }),
      this.prisma.workerBillingSession.findMany({ where: { billingEndedAt: null }, select: { hourlyRateCp: true, paidVndPerCp: true, billingStartedAt: true } }),
      this.prisma.pipelineJob.findMany({ where: { status: 'FAILED' }, select: { id: true, failureCode: true, updatedAt: true, video: { select: { displayTitle: true } } }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: 20 }),
      this.prisma.pipelineJob.findMany({ where: { status: 'WAITING_FOR_GPU', updatedAt: { lte: waitingGpuBefore } }, select: { id: true, updatedAt: true, video: { select: { displayTitle: true } } }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: 20 }),
      this.prisma.publicationTask.findMany({ where: { status: { notIn: ['PUBLISHED', 'VERIFIED', 'CANCELLED'] }, deadlineAt: { lt: now } }, select: { id: true, deadlineAt: true, updatedAt: true, destination: { select: { displayName: true } } }, orderBy: [{ deadlineAt: 'asc' }, { id: 'asc' }], take: 20 }),
      this.prisma.publicationTask.findMany({ where: { status: 'NEEDS_REVISION' }, select: { id: true, updatedAt: true, destination: { select: { displayName: true } } }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: 20 }),
      this.prisma.worker.findMany({ where: { observedStatus: { in: ['SAFE_TO_TERMINATE', 'OFFLINE', 'ERROR'] } }, select: { id: true, displayName: true, observedStatus: true, updatedAt: true, billingSessions: { where: { billingEndedAt: null }, select: { id: true }, take: 1 } }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.sourceAccount.findMany({ select: { id: true, displayName: true, status: true, cooldownUntil: true, updatedAt: true, credentials: { where: { revokedAt: null }, select: { expiresAt: true }, orderBy: { encryptedAt: 'desc' }, take: 1 } }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.workflowEvent.findMany({ select: { id: true, pipelineJobId: true, videoId: true, eventType: true, messageSafe: true, occurredAt: true }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 24 }),
      this.prisma.auditEvent.findMany({ where: { entityType: { not: 'PIPELINE_JOB' } }, select: { id: true, action: true, entityType: true, entityId: true, occurredAt: true }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 24 }),
      this.prisma.publicationProof.findMany({ select: { id: true, publicationTaskId: true, submittedAt: true, verifiedAt: true, verificationStatus: true, task: { select: { destination: { select: { displayName: true } } } } }, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], take: 12 }),
    ]);

    const videoCounts = countMap(VIDEO_STATUSES, videoGroups.map((row) => [row.status, row._count._all])) as DashboardVideoCounts;
    const jobCounts = new Map(jobGroups.map((row) => [row.status, row._count._all]));
    const publicationCounts = new Map(publicationGroups.map((row) => [row.status, row._count._all]));
    const workerCounts = new Map(workerGroups.map((row) => [row.observedStatus, row._count._all]));
    const attention = await this.attention({ now, credentialWarningAt, waitingGpuBefore, overdueTotal: overdue, failedJobs, waitingGpuJobs, overdueTasks, revisionTasks, workers, sourceAccounts });
    const cost = billingCost(billing, now);

    return {
      generatedAt: now.toISOString(),
      timezone: 'Asia/Ho_Chi_Minh',
      videos: {
        countsByStatus: videoCounts,
        processing: videoCounts.INGEST_QUEUED + videoCounts.INGESTING + videoCounts.INGESTED + videoCounts.PROCESSING,
        awaitingReview: videoCounts.AWAITING_REVIEW,
        readyToPublish: videoCounts.READY_TO_PUBLISH,
        published: videoCounts.PUBLISHED,
        failed: videoCounts.FAILED,
        totalActive: VIDEO_STATUSES.filter((status) => status !== 'ARCHIVED').reduce((sum, status) => sum + videoCounts[status], 0),
      },
      queue: { active: ACTIVE_JOBS.reduce((sum, status) => sum + (jobCounts.get(status) ?? 0), 0), running: jobCounts.get('RUNNING') ?? 0, waitingForGpu: jobCounts.get('WAITING_FOR_GPU') ?? 0, failed: jobCounts.get('FAILED') ?? 0 },
      publishing: { upcoming, overdue, awaitingProof: publicationCounts.get('POSTING_MANUAL') ?? 0, awaitingVerification: publicationCounts.get('PUBLISHED') ?? 0, needsRevision: publicationCounts.get('NEEDS_REVISION') ?? 0 },
      workers: { online: ONLINE_WORKERS.reduce((sum, status) => sum + (workerCounts.get(status) ?? 0), 0), busy: workerCounts.get('BUSY') ?? 0, safeToTerminate: workerCounts.get('SAFE_TO_TERMINATE') ?? 0, unhealthy: (workerCounts.get('OFFLINE') ?? 0) + (workerCounts.get('ERROR') ?? 0), activeLeases },
      cost,
      attention,
      recentActivity: { items: activity(workflowEvents, auditEvents, proofs) },
    };
  }

  private async attention(input: AttentionInput): Promise<Dashboard['attention']> {
    const [failedTotal, waitingTotal, revisionTotal] = await Promise.all([
      this.prisma.pipelineJob.count({ where: { status: 'FAILED' } }),
      this.prisma.pipelineJob.count({ where: { status: 'WAITING_FOR_GPU', updatedAt: { lte: input.waitingGpuBefore } } }),
      this.prisma.publicationTask.count({ where: { status: 'NEEDS_REVISION' } }),
    ]);
    const items: DashboardAttentionItem[] = [];
    for (const worker of input.workers) {
      if (!worker.billingSessions.length) continue;
      const offline = worker.observedStatus === 'OFFLINE' || worker.observedStatus === 'ERROR';
      items.push(attentionItem(offline ? 'WORKER_BILLING_OFFLINE' : 'WORKER_BILLING_SAFE_TO_TERMINATE', 'CRITICAL', offline ? 'Worker lỗi hoặc offline vẫn đang tính phí' : 'Worker có thể tắt nhưng vẫn đang tính phí', worker.displayName, 'WORKER', worker.id, worker.updatedAt, null, `/workers?workerId=${worker.id}`));
    }
    for (const task of input.overdueTasks) items.push(attentionItem('PUBLICATION_OVERDUE', 'CRITICAL', 'Task đăng bài đã quá hạn', task.destination.displayName, 'PUBLICATION_TASK', task.id, task.updatedAt, task.deadlineAt, `/publishing?taskId=${task.id}`));
    for (const job of input.failedJobs) items.push(attentionItem('QUEUE_JOB_FAILED', 'WARNING', 'Job xử lý thất bại', `${job.video.displayTitle ?? 'Video chưa có tiêu đề'} · ${job.failureCode ?? 'Không có mã lỗi'}`, 'PIPELINE_JOB', job.id, job.updatedAt, null, `/queue?jobId=${job.id}`));
    for (const job of input.waitingGpuJobs) items.push(attentionItem('QUEUE_WAITING_FOR_GPU', 'WARNING', 'Job chờ GPU quá 15 phút', job.video.displayTitle ?? 'Video chưa có tiêu đề', 'PIPELINE_JOB', job.id, job.updatedAt, null, `/queue?jobId=${job.id}`));
    for (const task of input.revisionTasks) items.push(attentionItem('PUBLICATION_NEEDS_REVISION', 'WARNING', 'Nội dung đăng bài cần chỉnh sửa', task.destination.displayName, 'PUBLICATION_TASK', task.id, task.updatedAt, null, `/publishing?taskId=${task.id}`));
    let sourceTotal = 0;
    for (const account of input.sourceAccounts) {
      const credential = account.credentials[0];
      const expired = account.status !== 'ACTIVE' || Boolean(credential?.expiresAt && credential.expiresAt <= input.now);
      const expiring = !expired && Boolean(credential?.expiresAt && credential.expiresAt <= input.credentialWarningAt);
      const cooldown = Boolean(account.cooldownUntil && account.cooldownUntil > input.now);
      if (expired) { sourceTotal += 1; items.push(attentionItem('SOURCE_CREDENTIAL_EXPIRED', 'CRITICAL', 'Cookie nguồn không còn hợp lệ', account.displayName, 'SOURCE_ACCOUNT', account.id, account.updatedAt, credential?.expiresAt ?? null, `/discovery?sourceAccountId=${account.id}`)); }
      if (expiring) { sourceTotal += 1; items.push(attentionItem('SOURCE_CREDENTIAL_EXPIRING', 'WARNING', 'Cookie nguồn sắp hết hạn', account.displayName, 'SOURCE_ACCOUNT', account.id, account.updatedAt, credential?.expiresAt ?? null, `/discovery?sourceAccountId=${account.id}`)); }
      if (cooldown) { sourceTotal += 1; items.push(attentionItem('SOURCE_ACCOUNT_COOLDOWN', 'WARNING', 'Nguồn đang trong thời gian chờ', account.displayName, 'SOURCE_ACCOUNT', account.id, account.updatedAt, account.cooldownUntil, `/discovery?sourceAccountId=${account.id}`)); }
    }
    items.sort(attentionSort);
    return { items: items.slice(0, 20), total: input.workers.filter((worker) => worker.billingSessions.length).length + input.overdueTotal + failedTotal + waitingTotal + revisionTotal + sourceTotal };
  }
}

type AttentionInput = {
  now: Date; credentialWarningAt: Date; waitingGpuBefore: Date; overdueTotal: number;
  failedJobs: Array<{ id: string; failureCode: string | null; updatedAt: Date; video: { displayTitle: string | null } }>;
  waitingGpuJobs: Array<{ id: string; updatedAt: Date; video: { displayTitle: string | null } }>;
  overdueTasks: Array<{ id: string; deadlineAt: Date | null; updatedAt: Date; destination: { displayName: string } }>;
  revisionTasks: Array<{ id: string; updatedAt: Date; destination: { displayName: string } }>;
  workers: Array<{ id: string; displayName: string; observedStatus: string; updatedAt: Date; billingSessions: Array<{ id: string }> }>;
  sourceAccounts: Array<{ id: string; displayName: string; status: string; cooldownUntil: Date | null; updatedAt: Date; credentials: Array<{ expiresAt: Date | null }> }>;
};

function countMap<const T extends readonly string[]>(keys: T, values: Array<[string, number]>) { const map = new Map(values); return Object.fromEntries(keys.map((key) => [key, map.get(key) ?? 0])) as Record<T[number], number>; }
function attentionItem(code: DashboardAttentionItem['code'], severity: DashboardAttentionItem['severity'], title: string, detail: string, entityType: DashboardAttentionItem['entityType'], entityId: string, occurredAt: Date, dueAt: Date | null, href: string): DashboardAttentionItem { return { id: `${code}:${entityId}`, code, severity, title, detail, entityType, entityId, occurredAt: occurredAt.toISOString(), dueAt: dueAt?.toISOString() ?? null, href }; }
function attentionSort(a: DashboardAttentionItem, b: DashboardAttentionItem) { const severity = (a.severity === 'CRITICAL' ? 0 : 1) - (b.severity === 'CRITICAL' ? 0 : 1); if (severity) return severity; return (a.dueAt ?? a.occurredAt).localeCompare(b.dueAt ?? b.occurredAt) || a.id.localeCompare(b.id); }

function billingCost(rows: Array<{ hourlyRateCp: Prisma.Decimal; paidVndPerCp: Prisma.Decimal | null; billingStartedAt: Date }>, now: Date): Dashboard['cost'] {
  let cp = new Prisma.Decimal(0); let vnd = new Prisma.Decimal(0); let rated = 0;
  for (const row of rows) { const elapsedMs = Math.max(0, now.valueOf() - row.billingStartedAt.valueOf()); const cost = row.hourlyRateCp.mul(elapsedMs).div(3_600_000); cp = cp.add(cost); if (row.paidVndPerCp) { rated += 1; vnd = vnd.add(cost.mul(row.paidVndPerCp)); } }
  const coverage = rows.length === 0 || rated === rows.length ? 'COMPLETE' : rated === 0 ? 'NONE' : 'PARTIAL';
  return { openBillingSessions: rows.length, estimatedCostCp: cp.toFixed(6), estimatedCostVnd: coverage === 'COMPLETE' ? vnd.toFixed(2) : null, vndCoverage: coverage };
}

function activity(workflow: Array<{ id: string; pipelineJobId: string | null; videoId: string | null; eventType: string; messageSafe: string | null; occurredAt: Date }>, audits: Array<{ id: string; action: string; entityType: string; entityId: string | null; occurredAt: Date }>, proofs: Array<{ id: string; publicationTaskId: string; submittedAt: Date; verifiedAt: Date | null; verificationStatus: string; task: { destination: { displayName: string } } }>): DashboardActivityItem[] {
  const items: DashboardActivityItem[] = workflow.map((event) => ({ id: `workflow:${event.id}`, kind: 'QUEUE_EVENT', title: event.eventType, detail: event.messageSafe, entityType: event.pipelineJobId ? 'PIPELINE_JOB' : 'VIDEO', entityId: event.pipelineJobId ?? event.videoId, occurredAt: event.occurredAt.toISOString(), href: event.pipelineJobId ? `/queue?jobId=${event.pipelineJobId}` : '/library' }));
  items.push(...audits.map((event) => ({ id: `audit:${event.id}`, kind: 'AUDIT_EVENT' as const, title: event.action, detail: null, entityType: event.entityType, entityId: event.entityId, occurredAt: event.occurredAt.toISOString(), href: auditHref(event.entityType, event.entityId) })));
  for (const proof of proofs) {
    items.push({ id: `proof-submitted:${proof.id}`, kind: 'PUBLICATION_PROOF_SUBMITTED', title: 'Đã ghi nhận publication proof', detail: proof.task.destination.displayName, entityType: 'PUBLICATION_TASK', entityId: proof.publicationTaskId, occurredAt: proof.submittedAt.toISOString(), href: `/publishing?taskId=${proof.publicationTaskId}` });
    if (proof.verifiedAt) items.push({ id: `proof-verified:${proof.id}`, kind: 'PUBLICATION_PROOF_VERIFIED', title: proof.verificationStatus === 'VERIFIED' ? 'Đã xác minh publication proof' : 'Publication proof không hợp lệ', detail: proof.task.destination.displayName, entityType: 'PUBLICATION_TASK', entityId: proof.publicationTaskId, occurredAt: proof.verifiedAt.toISOString(), href: `/publishing?taskId=${proof.publicationTaskId}` });
  }
  return items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id)).slice(0, 12);
}
function auditHref(type: string, id: string | null) { if (!id) return '/'; if (type.includes('WORKER')) return `/workers?workerId=${id}`; if (type.includes('PUBLICATION')) return `/publishing?taskId=${id}`; if (type.includes('VIDEO')) return `/library/${id}`; if (type.includes('SOURCE') || type.includes('DISCOVERY')) return '/discovery'; return '/'; }
