import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const requestId = '0191f3d2-7f5b-7abc-8b2e-123456789abd';
const settings = {
  version: 3,
  contentAgent: { provider: 'ANTHROPIC', model: 'claude-sonnet-5', credential: { configured: true, hint: '3f8a', rotatedAt: '2026-09-19T10:00:00.000Z' } },
  storage: { backend: 'R2', accountId: '8f3c00000000000000000000000000a4', bucket: 'reup-dubbing-media', credential: { configured: true, hint: 'K2M9', rotatedAt: '2026-09-19T10:00:00.000Z' } },
  retention: { rawVideoDays: 7, intermediateDays: 3, taskLogDays: 30, finalOutputDays: 90 },
};

async function mockSettings(page: Page) {
  await page.route('**/v1/settings', async (route) => {
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON() as { retention?: { rawVideoDays?: number } };
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { ETag: '"4"', 'X-Request-Id': requestId, 'Access-Control-Expose-Headers': 'ETag, X-Request-Id' }, body: JSON.stringify({ data: { ...settings, version: 4, retention: { ...settings.retention, ...patch.retention } }, meta: { requestId } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { ETag: '"3"', 'X-Request-Id': requestId, 'Access-Control-Expose-Headers': 'ETag, X-Request-Id' }, body: JSON.stringify({ data: settings, meta: { requestId } }) });
  });
}

test('loads and saves Settings without exposing stored credentials', async ({ page }) => {
  await mockSettings(page);
  await page.goto('/settings');
  await expect(page.getByLabel('Model')).toHaveValue('claude-sonnet-5');
  await expect(page.getByLabel('API key')).toHaveValue('');
  await expect(page.getByLabel('API key')).toHaveAttribute('placeholder', 'Đã lưu · ••••3f8a');
  await page.getByLabel('Video gốc').fill('14');
  const requestPromise = page.waitForRequest((request) => request.url().endsWith('/v1/settings') && request.method() === 'PATCH');
  await page.getByRole('button', { name: 'Lưu cài đặt' }).click();
  const request = await requestPromise;
  expect(request.headers()['if-match']).toBe('"3"');
  expect(request.headers()['idempotency-key']).toBeTruthy();
  expect(request.postDataJSON()).toEqual({ retention: { rawVideoDays: 14 } });
  await expect(page.getByText('Mọi thay đổi đã được lưu')).toBeVisible();
  await expect(page.getByLabel('API key')).toHaveValue('');
});

test('Settings stays usable on mobile and has no serious accessibility violations', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await mockSettings(page);
  await page.goto('/settings');
  await expect(page.getByLabel('Model')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
});
