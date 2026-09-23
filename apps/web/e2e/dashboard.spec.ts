import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const requestId = '0191f3d2-7f5b-7abc-8b2e-123456789abd';
const dashboard = {
  generatedAt: '2026-09-23T03:30:00.000Z', timezone: 'Asia/Ho_Chi_Minh',
  videos: { countsByStatus: { INGEST_QUEUED: 1, INGESTING: 0, INGESTED: 2, PROCESSING: 3, AWAITING_REVIEW: 5, READY_TO_PUBLISH: 6, PUBLISHED: 18, FAILED: 1, ARCHIVED: 0 }, processing: 3, awaitingReview: 5, readyToPublish: 6, published: 18, failed: 1, totalActive: 18 },
  queue: { active: 7, running: 4, waitingForGpu: 2, failed: 1 },
  publishing: { upcoming: 3, overdue: 1, awaitingProof: 2, awaitingVerification: 1, needsRevision: 0 },
  workers: { online: 2, busy: 1, safeToTerminate: 1, unhealthy: 0, activeLeases: 2 },
  cost: { openBillingSessions: 2, estimatedCostCp: '13000.000000', estimatedCostVnd: '13000.00', vndCoverage: 'COMPLETE' },
  attention: { total: 1, items: [{ id: 'attention:queue:1', code: 'QUEUE_WAITING_FOR_GPU', severity: 'WARNING', title: 'Job đang chờ GPU', detail: 'Job đã chờ capacity hơn 15 phút.', entityType: 'PIPELINE_JOB', entityId: '0191f3d2-7f5b-7abc-8b2e-123456789af8', occurredAt: '2026-09-23T03:00:00.000Z', dueAt: null, href: '/queue?jobId=0191f3d2-7f5b-7abc-8b2e-123456789af8' }] },
  recentActivity: { items: [{ id: 'activity:queue:1', kind: 'QUEUE_EVENT', title: 'Job bắt đầu xử lý', detail: 'Video Queue mẫu', entityType: 'PIPELINE_JOB', entityId: '0191f3d2-7f5b-7abc-8b2e-123456789af8', occurredAt: '2026-09-23T03:20:00.000Z', href: '/queue' }] },
};

async function mockDashboard(page: Page) {
  await page.route('**/v1/dashboard', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: dashboard, meta: { requestId } }) }));
  await page.route('**/v1/health/ready', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { status: 'ok' }, meta: { requestId } }) }));
}

test('shows the operational projection and quick actions accessibly', async ({ page }) => {
  await mockDashboard(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tổng quan vận hành' })).toBeVisible();
  await expect(page.getByText('Job đang chờ GPU')).toBeVisible();
  await expect(page.getByText('Job bắt đầu xử lý')).toBeVisible();
  await expect(page.getByText('13.000 CP')).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);

  await page.getByRole('link', { name: /Tìm nội dung nguồn mới/ }).click();
  await expect(page).toHaveURL('/discovery');
});

test('has no horizontal overflow on a 375px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await mockDashboard(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tổng quan vận hành' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('opens the exact Queue detail referenced by Dashboard attention', async ({ page }) => {
  const task = { id: '0191f3d2-7f5b-7abc-8b2e-123456789af9', taskType: 'DOWNLOAD', resourceClass: 'IO', status: 'READY', progressPercent: 25, progressDetail: 'Đang chuẩn bị tải', attemptCount: 0, maxAttempts: 3, readyAt: '2026-09-20T08:31:00.000Z', version: 1, createdAt: '2026-09-20T08:31:00.000Z', updatedAt: '2026-09-20T08:32:00.000Z' };
  const job = { id: '0191f3d2-7f5b-7abc-8b2e-123456789af8', videoId: '0191f3d2-7f5b-7abc-8b2e-123456789af7', kind: 'INGEST', status: 'WAITING_FOR_GPU', version: 1, title: 'Video Queue mẫu', channelProfileId: '0191f3d2-7f5b-7abc-8b2e-123456789ac0', channelProfileName: 'Kênh Việt hóa', seriesProfileId: null, seriesProfileName: null, currentTask: task, progress: { percent: 25, completedTasks: 0, totalTasks: 1 }, failure: null, actions: { canRetry: false, canCancel: true }, startedAt: null, finishedAt: null, createdAt: '2026-09-20T08:31:00.000Z', updatedAt: '2026-09-20T08:32:00.000Z' };
  const envelope = (data: unknown) => JSON.stringify({ data, meta: { requestId } });
  await mockDashboard(page);
  await page.route('**/v1/queue/events', (route) => route.fulfill({ contentType: 'text/event-stream', body: '' }));
  await page.route('**/v1/queue/jobs**', (route) => route.fulfill({ contentType: 'application/json', body: envelope({ items: [job], nextCursor: null }) }));
  await page.route('**/v1/queue/jobs/*', (route) => route.fulfill({ contentType: 'application/json', body: envelope({ ...job, tasks: [task], timeline: [] }) }));
  await page.route('**/v1/queue/jobs/*/attempts**', (route) => route.fulfill({ contentType: 'application/json', body: envelope({ items: [], nextCursor: null }) }));
  await page.goto('/');
  await page.getByRole('link', { name: /Job đang chờ GPU/ }).click();
  await expect(page).toHaveURL(/\/queue\?jobId=0191f3d2/);
  await expect(page.getByRole('heading', { name: 'Tiến độ pipeline' })).toBeVisible();
  await expect(page.getByText('Video Queue mẫu', { exact: true }).first()).toBeVisible();
});
