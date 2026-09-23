import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const libraryVideo = { id: '0191f3d2-7f5b-7abc-8b2e-123456789d01', version: 1, displayTitle: 'Video Library mẫu', status: 'AWAITING_REVIEW', sourceLanguage: 'zh', targetLanguage: 'vi', source: { platform: 'DOUYIN', externalId: 'douyin-1', canonicalUrl: null, durationMs: 30000, creatorName: 'Kênh mẫu' }, profile: { channelProfileId: '0191f3d2-7f5b-7abc-8b2e-123456789d02', channelProfileName: 'Kênh Việt hóa', seriesProfileId: null, seriesProfileName: null }, latestJob: null, reviewStatus: 'PENDING', outputSummary: { readiness: 'NONE', requiredVariants: [], availableVariants: [], warnings: [] }, thumbnail: null, outputs: [], assets: [], createdAt: '2026-09-20T08:00:00.000Z', updatedAt: '2026-09-20T08:00:00.000Z', ingestedAt: null, archivedAt: null, capabilities: { canOpenStudio: true, canOpenPublishing: false, canArchive: true } };
async function mockLibrary(page: Page) { await page.route('**/v1/videos**', (route) => { const detail = route.request().url().endsWith(`/${libraryVideo.id}`); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: detail ? libraryVideo : { items: [libraryVideo], nextCursor: null } }) }); }); }

test('active Library routes keep the shell', async ({ page }) => {
  await mockLibrary(page); await page.goto('/library'); await expect(page.getByRole('heading', { name: 'Thư viện video' })).toBeVisible();
  await page.goto(`/library/${libraryVideo.id}`); await expect(page.getByRole('heading', { name: 'Video Library mẫu' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
  const breadcrumb = page.getByLabel('Breadcrumb');
  await expect(breadcrumb.getByRole('link', { name: 'Thư viện video' })).toHaveAttribute('href', '/library');
  await expect(breadcrumb).toContainText('Chi tiết video');
});

test('unknown route is accessible and links home', async ({ page }) => {
  await page.goto('/not-a-route');
  await expect(page.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
  await page.getByRole('link', { name: 'Về trang nền tảng' }).click();
  await expect(page).toHaveURL('/');
});
