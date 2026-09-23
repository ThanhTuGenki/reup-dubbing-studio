import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const requestId = '0191f3d2-7f5b-7abc-8b2e-123456789abd';
async function ready(page: Page) {
  await page.route('**/v1/health/ready', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'X-Request-Id': requestId }, body: JSON.stringify({ data: { status: 'ok' }, meta: { requestId } }) }));
  await page.route('**/v1/dashboard', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dashboardEnvelope) }));
}

const dashboardEnvelope = { data: { generatedAt: '2026-09-23T03:30:00.000Z', timezone: 'Asia/Ho_Chi_Minh', videos: { countsByStatus: { INGEST_QUEUED: 0, INGESTING: 0, INGESTED: 0, PROCESSING: 1, AWAITING_REVIEW: 2, READY_TO_PUBLISH: 3, PUBLISHED: 4, FAILED: 0, ARCHIVED: 0 }, processing: 1, awaitingReview: 2, readyToPublish: 3, published: 4, failed: 0, totalActive: 6 }, queue: { active: 2, running: 1, waitingForGpu: 0, failed: 0 }, publishing: { upcoming: 1, overdue: 0, awaitingProof: 0, awaitingVerification: 0, needsRevision: 0 }, workers: { online: 1, busy: 1, safeToTerminate: 0, unhealthy: 0, activeLeases: 1 }, cost: { openBillingSessions: 1, estimatedCostCp: '100.000000', estimatedCostVnd: null, vndCoverage: 'NONE' }, attention: { items: [], total: 0 }, recentActivity: { items: [] } }, meta: { requestId } };

const responsiveViewports = [
  { name: 'mobile compact', width: 360, height: 800 },
  { name: 'mobile standard', width: 390, height: 844 },
  { name: 'mobile large', width: 430, height: 932 },
  { name: 'foldable/tablet nhỏ', width: 600, height: 960 },
  { name: 'tablet dọc', width: 820, height: 1180 },
  { name: 'tablet ngang', width: 1024, height: 768 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'wide', width: 1920, height: 1080 },
] as const;

for (const viewport of responsiveViewports) {
  test(`shell has no horizontal overflow at ${viewport.name} (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await ready(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Tổng quan vận hành' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}

test('mobile drawer supports keyboard, Escape, and focus return', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await ready(page);
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Mở điều hướng' });
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(menu).toBeFocused();
});

test('desktop shell exposes grouped navigation and can collapse', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page);
  await page.goto('/');
  const navigation = page.getByRole('navigation', { name: 'Điều hướng chính' });
  await expect(navigation.getByRole('link')).toHaveCount(9);
  await expect(page.getByLabel('Breadcrumb')).toContainText('Tổng quan');
  await page.getByRole('button', { name: 'Thu gọn điều hướng' }).click();
  await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toBeVisible();
});

test('command palette navigates by technical keyword', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await ready(page);
  await page.goto('/');
  await page.keyboard.press('Control+K');
  await page.getByPlaceholder('Nhập tên màn hình…').fill('storage');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
  await page.getByRole('option', { name: /Cài đặt/ }).click();
  await expect(page).toHaveURL('/settings');
  await expect(page.getByRole('heading', { name: 'Cài đặt hệ thống' })).toBeVisible();
});

for (const viewport of [responsiveViewports[0], responsiveViewports[7]]) {
  test(`dashboard shell has no serious accessibility violations at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await ready(page);
    await page.goto('/');
    await expect(page.getByText('Không có việc khẩn cấp')).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
  });
}
