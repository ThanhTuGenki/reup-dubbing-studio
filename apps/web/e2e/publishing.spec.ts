import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const requestId = '0191f3d2-7f5b-7abc-8b2e-123456789abd';
const taskId = '0191f3d2-7f5b-7abc-8b2e-123456789c01';
const task = {
  id: taskId,
  packageId: '0191f3d2-7f5b-7abc-8b2e-123456789c02',
  videoId: '0191f3d2-7f5b-7abc-8b2e-123456789af7',
  destinationId: '0191f3d2-7f5b-7abc-8b2e-123456789ad0',
  renderOutputId: '0191f3d2-7f5b-7abc-8b2e-123456789c03',
  platform: 'YOUTUBE',
  destinationName: 'YouTube Việt hóa',
  status: 'CONTENT_GENERATED',
  isRequired: true,
  scheduledAt: '2026-09-23T02:00:00.000Z',
  deadlineAt: '2026-09-23T03:00:00.000Z',
  version: 3,
  updatedAt: '2026-09-22T10:00:00.000Z',
  notes: 'Kiểm tra visibility trước khi đăng',
  publishedAt: null,
  contentSubjectVersion: 'publication-task:test:fields:test',
  fields: [{
    id: '0191f3d2-7f5b-7abc-8b2e-123456789c04', key: 'title', isLocked: false, version: 1,
    currentRevision: { id: '0191f3d2-7f5b-7abc-8b2e-123456789c05', revision: 1, value: 'Tiêu đề YouTube mẫu', origin: 'USER_EDITED', createdAt: '2026-09-22T09:00:00.000Z' },
    revisions: [{ id: '0191f3d2-7f5b-7abc-8b2e-123456789c05', revision: 1, value: 'Tiêu đề YouTube mẫu', origin: 'USER_EDITED', createdAt: '2026-09-22T09:00:00.000Z' }],
  }],
  checklist: [{ id: '0191f3d2-7f5b-7abc-8b2e-123456789c08', key: 'uploadVideo', label: 'Tải video lên', isRequired: true, status: 'PENDING', ordinal: 0, completedAt: null }],
  proofs: [], siblingTasks: [], assetAvailability: { VIDEO: true, SUBTITLE: true, THUMBNAIL: false },
};
const listItem = (({ fields: _fields, checklist: _checklist, proofs: _proofs, siblingTasks: _siblings, assetAvailability: _assets, notes: _notes, publishedAt: _publishedAt, contentSubjectVersion: _subject, ...item }) => item)(task);

async function fulfill(route: Route, data: unknown) {
  return route.fulfill({ contentType: 'application/json', headers: { ETag: '"3"', 'Access-Control-Expose-Headers': 'ETag' }, body: JSON.stringify({ data, meta: { requestId } }) });
}

async function mockPublishing(page: Page) {
  await page.route('**/v1/publication-tasks**', (route) => fulfill(route, { items: [listItem], nextCursor: null }));
  await page.route(`**/v1/publication-tasks/${taskId}`, (route) => fulfill(route, task));
}

test('opens the Publishing workspace with accessible task details', async ({ page }) => {
  await mockPublishing(page);
  await page.goto('/publishing');
  await expect(page.getByRole('heading', { name: 'Bàn đăng bài' })).toBeVisible();
  await page.getByRole('button', { name: 'Mở task' }).first().click();
  await expect(page.getByText('Asset bàn giao')).toBeVisible();
  await expect(page.getByText('Checklist đăng thủ công')).toBeVisible();
  await expect(page.getByText('Publication proof')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
});

test('Publishing uses mobile cards without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await mockPublishing(page);
  await page.goto('/publishing');
  await expect(page.getByRole('button', { name: 'Mở task' }).last()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
