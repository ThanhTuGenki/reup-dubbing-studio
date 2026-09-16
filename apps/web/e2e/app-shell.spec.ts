import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const requestId = '0191f3d2-7f5b-7abc-8b2e-123456789abd';
async function ready(page: Page) {
  await page.route('**/v1/health/ready', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'X-Request-Id': requestId }, body: JSON.stringify({ data: { status: 'ok' }, meta: { requestId } }) }));
}

for (const width of [375, 768, 1440]) {
  test(`shell is usable without horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Nền tảng vận hành đã sẵn sàng.' })).toBeVisible();
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

test('foundation shell has no serious accessibility violations', async ({ page }) => {
  await ready(page);
  await page.goto('/');
  await expect(page.getByText('Sẵn sàng', { exact: true })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
});
