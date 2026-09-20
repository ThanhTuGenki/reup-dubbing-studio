import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const path of ['/library', '/library/video-1', '/publishing', '/workers']) {
  test(`reserved route ${path} keeps the shell`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Tính năng chưa khả dụng' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
  });
}

test('unknown route is accessible and links home', async ({ page }) => {
  await page.goto('/not-a-route');
  await expect(page.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
  await page.getByRole('link', { name: 'Về trang nền tảng' }).click();
  await expect(page).toHaveURL('/');
});
