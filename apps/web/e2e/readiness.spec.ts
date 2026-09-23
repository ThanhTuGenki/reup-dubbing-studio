import { expect, test } from '@playwright/test';

const requestId = '0191f3d2-7f5b-7abc-8b2e-123456789abd';
const emptyDashboard = { generatedAt: '2026-09-23T03:30:00.000Z', timezone: 'Asia/Ho_Chi_Minh', videos: { countsByStatus: { INGEST_QUEUED: 0, INGESTING: 0, INGESTED: 0, PROCESSING: 0, AWAITING_REVIEW: 0, READY_TO_PUBLISH: 0, PUBLISHED: 0, FAILED: 0, ARCHIVED: 0 }, processing: 0, awaitingReview: 0, readyToPublish: 0, published: 0, failed: 0, totalActive: 0 }, queue: { active: 0, running: 0, waitingForGpu: 0, failed: 0 }, publishing: { upcoming: 0, overdue: 0, awaitingProof: 0, awaitingVerification: 0, needsRevision: 0 }, workers: { online: 0, busy: 0, safeToTerminate: 0, unhealthy: 0, activeLeases: 0 }, cost: { openBillingSessions: 0, estimatedCostCp: '0.000000', estimatedCostVnd: null, vndCoverage: 'NONE' }, attention: { items: [], total: 0 }, recentActivity: { items: [] } };

test('shows an empty Dashboard projection safely', async ({ page }) => {
  await page.route('**/v1/dashboard', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: emptyDashboard, meta: { requestId } }) }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tổng quan vận hành' })).toBeVisible();
  await expect(page.getByText('Không có việc khẩn cấp')).toBeVisible();
  await expect(page.getByText('Chưa có hoạt động')).toBeVisible();
});

test('shows a safe Dashboard error and allows a manual retry', async ({ page }) => {
  let calls = 0;
  let shouldFail = true;
  await page.route('**/v1/dashboard', (route) => {
    calls += 1;
    if (shouldFail) return route.fulfill({ status: 503, contentType: 'application/problem+json', headers: { 'X-Request-Id': requestId }, body: JSON.stringify({ type: 'about:blank', title: 'Unavailable', detail: 'raw-internal-secret', status: 503, instance: '/v1/dashboard', code: 'INTERNAL_ERROR', requestId }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: emptyDashboard, meta: { requestId } }) });
  });
  await page.goto('/');
  await expect(page.getByText('Không thể tải tổng quan')).toBeVisible();
  await expect(page.getByText('raw-internal-secret')).toHaveCount(0);
  shouldFail = false;
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByRole('heading', { name: 'Tổng quan vận hành' })).toBeVisible();
  expect(calls).toBeGreaterThanOrEqual(2);
});
