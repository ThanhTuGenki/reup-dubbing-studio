import { Prisma, type PrismaClient } from '@prisma/client';

import { PrismaDashboardRepository } from '../../src/modules/dashboard/infrastructure/prisma-dashboard-repository';

const now = new Date('2026-09-22T17:00:00.000Z');

function createPrisma() {
  return {
    video: { groupBy: jest.fn().mockResolvedValue([]) },
    pipelineJob: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    publicationTask: {
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    worker: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
    taskLease: { count: jest.fn().mockResolvedValue(0) },
    workerBillingSession: { findMany: jest.fn().mockResolvedValue([]) },
    sourceAccount: { findMany: jest.fn().mockResolvedValue([]) },
    workflowEvent: { findMany: jest.fn().mockResolvedValue([]) },
    auditEvent: { findMany: jest.fn().mockResolvedValue([]) },
    publicationProof: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('PrismaDashboardRepository', () => {
  it('returns a stable empty projection rather than partial missing sections', async () => {
    const prisma = createPrisma();
    const dashboard = await new PrismaDashboardRepository(prisma as unknown as PrismaClient, () => now).get();

    expect(dashboard).toMatchObject({
      generatedAt: now.toISOString(), timezone: 'Asia/Ho_Chi_Minh',
      videos: { processing: 0, awaitingReview: 0, readyToPublish: 0, published: 0, failed: 0, totalActive: 0 },
      queue: { active: 0, running: 0, waitingForGpu: 0, failed: 0 },
      publishing: { upcoming: 0, overdue: 0, awaitingProof: 0, awaitingVerification: 0, needsRevision: 0 },
      workers: { online: 0, busy: 0, safeToTerminate: 0, unhealthy: 0, activeLeases: 0 },
      cost: { openBillingSessions: 0, estimatedCostCp: '0.000000', estimatedCostVnd: '0.00', vndCoverage: 'COMPLETE' },
      attention: { items: [], total: 0 }, recentActivity: { items: [] },
    });
    expect(Object.values(dashboard.videos.countsByStatus)).toEqual(Array(9).fill(0));
  });

  it('uses inclusive 7-day, 72-hour and 15-minute boundaries and preserves partial billing', async () => {
    const prisma = createPrisma();
    const jobId = '0191f3d2-7f5b-7abc-8b2e-123456789af8';
    const accountId = '0191f3d2-7f5b-7abc-8b2e-123456789af0';
    const waitingBoundary = new Date(now.valueOf() - 15 * 60_000);
    const credentialBoundary = new Date(now.valueOf() + 72 * 60 * 60_000);

    prisma.publicationTask.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    prisma.pipelineJob.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: jobId, updatedAt: waitingBoundary, video: { displayTitle: 'Boundary job' } }]);
    prisma.pipelineJob.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    prisma.workerBillingSession.findMany.mockResolvedValue([
      { hourlyRateCp: new Prisma.Decimal(10), paidVndPerCp: new Prisma.Decimal(2), billingStartedAt: new Date(now.valueOf() - 60 * 60_000) },
      { hourlyRateCp: new Prisma.Decimal(20), paidVndPerCp: null, billingStartedAt: new Date(now.valueOf() - 30 * 60_000) },
    ]);
    prisma.sourceAccount.findMany.mockResolvedValue([{ id: accountId, displayName: 'Nguồn sắp hết hạn', status: 'ACTIVE', cooldownUntil: null, updatedAt: now, credentials: [{ expiresAt: credentialBoundary }] }]);

    const dashboard = await new PrismaDashboardRepository(prisma as unknown as PrismaClient, () => now).get();

    expect(prisma.publicationTask.count).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: expect.objectContaining({ scheduledAt: { gte: now, lte: new Date(now.valueOf() + 7 * 24 * 60 * 60_000) } }) }));
    expect(prisma.pipelineJob.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { status: 'WAITING_FOR_GPU', updatedAt: { lte: waitingBoundary } } }));
    expect(dashboard.publishing.upcoming).toBe(1);
    expect(dashboard.cost).toEqual({ openBillingSessions: 2, estimatedCostCp: '20.000000', estimatedCostVnd: null, vndCoverage: 'PARTIAL' });
    expect(dashboard.attention.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SOURCE_CREDENTIAL_EXPIRING', entityId: accountId, dueAt: credentialBoundary.toISOString(), href: `/discovery?sourceAccountId=${accountId}` }),
      expect.objectContaining({ code: 'QUEUE_WAITING_FOR_GPU', entityId: jobId, href: `/queue?jobId=${jobId}` }),
    ]));
  });
});
