import { expect, test } from '@playwright/test';

test('serves the TypeScript web application', async ({ page }) => {
  await page.route('**/v1/dashboard', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { generatedAt: '2026-09-23T03:30:00.000Z', timezone: 'Asia/Ho_Chi_Minh', videos: { countsByStatus: { INGEST_QUEUED: 0, INGESTING: 0, INGESTED: 0, PROCESSING: 0, AWAITING_REVIEW: 0, READY_TO_PUBLISH: 0, PUBLISHED: 0, FAILED: 0, ARCHIVED: 0 }, processing: 0, awaitingReview: 0, readyToPublish: 0, published: 0, failed: 0, totalActive: 0 }, queue: { active: 0, running: 0, waitingForGpu: 0, failed: 0 }, publishing: { upcoming: 0, overdue: 0, awaitingProof: 0, awaitingVerification: 0, needsRevision: 0 }, workers: { online: 0, busy: 0, safeToTerminate: 0, unhealthy: 0, activeLeases: 0 }, cost: { openBillingSessions: 0, estimatedCostCp: '0.000000', estimatedCostVnd: null, vndCoverage: 'NONE' }, attention: { items: [], total: 0 }, recentActivity: { items: [] } }, meta: { requestId: '0191f3d2-7f5b-7abc-8b2e-123456789abd' } }) }));
  await page.goto('/');
  await expect(page).toHaveTitle('Reup Dubbing Studio — Tổng quan');
  await expect(page.getByRole('heading', { name: 'Tổng quan vận hành' })).toBeVisible();
});
