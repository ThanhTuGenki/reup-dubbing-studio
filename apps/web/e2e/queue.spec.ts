import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const requestId = '0191f3d2-7f5b-7abc-8b2e-123456789abd';
const jobId = '0191f3d2-7f5b-7abc-8b2e-123456789af8';
const videoId = '0191f3d2-7f5b-7abc-8b2e-123456789af7';
const task = { id: '0191f3d2-7f5b-7abc-8b2e-123456789af9', taskType: 'DOWNLOAD', resourceClass: 'IO', status: 'READY', progressPercent: 25, progressDetail: 'Đang chuẩn bị tải', attemptCount: 0, maxAttempts: 3, readyAt: '2026-09-20T08:31:00.000Z', version: 1, createdAt: '2026-09-20T08:31:00.000Z', updatedAt: '2026-09-20T08:32:00.000Z' };
const job = { id: jobId, videoId, kind: 'INGEST', status: 'QUEUED', version: 1, title: 'Video Queue mẫu', channelProfileId: '0191f3d2-7f5b-7abc-8b2e-123456789ac0', channelProfileName: 'Kênh Việt hóa', seriesProfileId: null, seriesProfileName: null, currentTask: task, progress: { percent: 25, completedTasks: 0, totalTasks: 1 }, failure: null, actions: { canRetry: false, canCancel: true }, startedAt: null, finishedAt: null, createdAt: '2026-09-20T08:31:00.000Z', updatedAt: '2026-09-20T08:32:00.000Z' };
const detail = { ...job, tasks: [task], timeline: [] };
async function fulfill(route: Route, data: unknown) { return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data, meta: { requestId } }) }); }
async function mockQueue(page: Page) { await page.route('**/v1/queue/events', (route) => route.fulfill({ contentType: 'text/event-stream', body: '' })); await page.route('**/v1/queue/jobs**', (route) => fulfill(route, { items: [job], nextCursor: null })); await page.route('**/v1/queue/jobs/*', (route) => fulfill(route, detail)); await page.route('**/v1/queue/jobs/*/attempts**', (route) => fulfill(route, { items: [], nextCursor: null })); }

test('browses Queue progress and task details accessibly', async ({ page }) => {
  await mockQueue(page); await page.goto('/queue');
  await expect(page.getByText('Video Queue mẫu').first()).toBeVisible();
  await page.getByRole('button', { name: 'Chi tiết' }).click();
  await expect(page.getByRole('heading', { name: 'Tiến độ pipeline' })).toBeVisible();
  await expect(page.getByText('Đang chuẩn bị tải', { exact: false })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
});

test('Queue uses cards without horizontal page overflow on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 }); await mockQueue(page); await page.goto('/queue');
  await expect(page.getByRole('button', { name: 'Xem chi tiết' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
