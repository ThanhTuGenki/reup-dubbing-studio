import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import type { PublicationTask } from '@reup-dubbing-studio/api-client';

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

async function mockPublishingFlow(page: Page) {
  let current: PublicationTask = structuredClone(task) as PublicationTask;
  const mutationHeaders: Array<{ etag: string | null; idempotencyKey: string | null }> = [];
  await page.route('**/v1/publication-tasks**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === 'GET' && url.pathname === '/v1/publication-tasks') return fulfill(route, { items: [listItem], nextCursor: null });
    if (method === 'GET' && url.pathname === `/v1/publication-tasks/${taskId}`) return fulfill(route, current);

    mutationHeaders.push({ etag: request.headers()['if-match'] ?? null, idempotencyKey: request.headers()['idempotency-key'] ?? null });
    const nextVersion = current.version + 1;
    if (url.pathname.endsWith('/approve-content')) current = { ...current, status: 'READY_TO_PUBLISH', version: nextVersion };
    else if (url.pathname.includes('/checklist/')) current = { ...current, version: nextVersion, checklist: current.checklist.map((item) => ({ ...item, status: 'COMPLETED', completedAt: '2026-09-22T11:00:00.000Z' })) };
    else if (url.pathname.endsWith('/start-manual-posting')) current = { ...current, status: 'POSTING_MANUAL', version: nextVersion };
    else if (url.pathname.endsWith('/proofs')) {
      const body = request.postDataJSON() as { publicUrl: string | null; platformPostId: string | null };
      expect(body).toEqual({ publicUrl: 'https://youtube.com/watch?v=published-123', platformPostId: 'published-123' });
      current = { ...current, status: 'PUBLISHED', publishedAt: '2026-09-22T11:05:00.000Z', version: nextVersion, proofs: [{ id: '0191f3d2-7f5b-7abc-8b2e-123456789c09', attemptNumber: 1, platformPostId: body.platformPostId, publicUrl: body.publicUrl, verificationStatus: 'PENDING', submittedAt: '2026-09-22T11:05:00.000Z', verifiedAt: null, verificationDetail: null }] };
    } else if (url.pathname.endsWith('/verify')) current = { ...current, status: 'VERIFIED', version: nextVersion, proofs: current.proofs.map((proof) => ({ ...proof, verificationStatus: 'VERIFIED', verifiedAt: '2026-09-22T11:10:00.000Z' })) };
    else return route.abort();
    return fulfill(route, current);
  });
  return { mutationHeaders };
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

test('completes the manual flow from approved content to verified proof', async ({ page }) => {
  const flow = await mockPublishingFlow(page);
  await page.goto('/publishing');
  await page.getByRole('button', { name: 'Mở task' }).first().click();
  await page.getByRole('button', { name: 'Duyệt nội dung' }).click();
  await expect(page.getByText('Sẵn sàng đăng').last()).toBeVisible();
  await page.getByRole('checkbox', { name: /Tải video lên/ }).click();
  await expect(page.getByText(/Đã xong/)).toBeVisible();
  await page.getByRole('button', { name: 'Bắt đầu đăng thủ công' }).click();
  await expect(page.getByText('Đang đăng thủ công').last()).toBeVisible();
  await page.getByLabel('Public URL').fill('https://youtube.com/watch?v=published-123');
  await page.getByLabel('Platform post ID').fill('published-123');
  await page.getByRole('button', { name: 'Ghi nhận proof' }).click();
  await expect(page.getByText('Chờ xác minh')).toBeVisible();
  await page.getByRole('button', { name: 'Xác minh' }).click();
  await expect(page.getByText('Đã xác minh').last()).toBeVisible();
  expect(flow.mutationHeaders.map(({ etag }) => etag)).toEqual(['"3"', '"4"', '"5"', '"6"', '"7"']);
  expect(flow.mutationHeaders.filter(({ idempotencyKey }) => idempotencyKey).length).toBe(4);
});

test('Publishing uses mobile cards without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await mockPublishing(page);
  await page.goto('/publishing');
  await expect(page.getByRole('button', { name: 'Mở task' }).last()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
