import { expect, test } from '@playwright/test';

const requestId = '0191f3d2-7f5b-7abc-8b2e-123456789abd';
test('shows ready state and API-owned support ID', async ({ page }) => {
  await page.route('**/v1/health/ready', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { status: 'ok' }, meta: { requestId } }) }));
  await page.goto('/');
  await expect(page.getByText('Sẵn sàng', { exact: true })).toBeVisible();
  await expect(page.getByText(`Mã hỗ trợ: ${requestId}`)).toBeVisible();
});

test('shows a safe error and allows a manual retry', async ({ page }) => {
  let calls = 0;
  await page.route('**/v1/health/ready', (route) => {
    calls += 1;
    if (calls <= 2) return route.fulfill({ status: 503, contentType: 'application/problem+json', headers: { 'X-Request-Id': requestId }, body: JSON.stringify({ type: 'about:blank', title: 'raw-internal-secret', status: 503, instance: '/v1/health/ready', code: 'INTERNAL_ERROR', requestId }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { status: 'ok' }, meta: { requestId } }) });
  });
  await page.goto('/');
  await expect(page.getByText('Cần kiểm tra')).toBeVisible();
  await expect(page.getByText('raw-internal-secret')).toHaveCount(0);
  await expect(page.getByText(`Mã hỗ trợ: ${requestId}`)).toBeVisible();
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByText('Sẵn sàng', { exact: true })).toBeVisible();
  expect(calls).toBeGreaterThanOrEqual(3);
});
