import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const videoId = '0191f3d2-7f5b-7abc-8b2e-123456789c01';
const studio = { video: { id: videoId, version: 4, title: 'Tập phim Studio', status: 'AWAITING_REVIEW', sourceDurationMs: 42000 }, transcriptRuns: [], cast: { id: '0191f3d2-7f5b-7abc-8b2e-123456789c03', status: 'APPROVED', version: 1, entries: [{ id: '0191f3d2-7f5b-7abc-8b2e-123456789c04', characterKey: 'narrator', displayName: 'Người kể', roleKind: 'NARRATOR', voice: { id: '0191f3d2-7f5b-7abc-8b2e-123456789c05', name: 'Giọng kể ấm' } }] }, segments: [{ id: '0191f3d2-7f5b-7abc-8b2e-123456789c02', ordinal: 1, sourceStartMs: 0, sourceEndMs: 2500, revision: { id: '0191f3d2-7f5b-7abc-8b2e-123456789c06', revision: 2, sourceText: '你好', translatedText: 'Xin chào', targetStartMs: 0, targetEndMs: 2500, speechRate: 1, status: 'DRAFT', castSheetEntryId: null, voice: { id: '0191f3d2-7f5b-7abc-8b2e-123456789c05', name: 'Giọng kể ấm' }, preview: null } }], reviews: [], capabilities: { canEdit: true, canRegenerate: true, canRender: true } };

async function mockStudio(page: Page) {
  await page.route('**/v1/queue/events', (route) => route.fulfill({ contentType: 'text/event-stream', body: '' }));
  await page.route(`**/v1/videos/${videoId}/studio`, (route) => route.fulfill({ contentType: 'application/json', headers: { ETag: '"4"' }, body: JSON.stringify({ data: studio }) }));
}

test('edits Studio transcript with accessible controls', async ({ page }) => {
  await mockStudio(page); await page.goto(`/library/${videoId}/studio`);
  await expect(page.getByRole('heading', { name: 'Tập phim Studio' })).toBeVisible();
  await page.getByLabel('Bản dịch segment').fill('Chào bạn');
  await expect(page.getByText('Chưa lưu thay đổi')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lưu revision' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Yêu cầu render' })).toBeDisabled();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
});

test('Studio editor avoids horizontal page overflow on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 }); await mockStudio(page); await page.goto(`/library/${videoId}/studio`);
  await expect(page.getByLabel('Bản dịch segment')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
