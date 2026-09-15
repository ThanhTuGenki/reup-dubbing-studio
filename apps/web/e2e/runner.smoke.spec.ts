import { expect, test } from '@playwright/test';

test('serves the TypeScript web application', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Reup Dubbing Studio');
  await expect(page.getByRole('heading', { name: 'Nền tảng vận hành đã sẵn sàng.' })).toBeVisible();
});
