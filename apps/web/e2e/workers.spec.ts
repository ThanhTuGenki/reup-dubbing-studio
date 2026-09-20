import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const requestId = '0191f3d2-7f5b-7abc-8b2e-123456789abd';
const image = { id: '0191f3d2-7f5b-7abc-8b2e-123456789b01', role: 'BATCH_MEDIA', semanticVersion: '1.8.2', imageDigest: `sha256:${'a'.repeat(64)}`, registryRef: 'ghcr.io/reup/media-worker@sha256:aaaa', contractVersion: 1, status: 'ACTIVE', approvedAt: '2026-09-20T07:00:00.000Z', revokedAt: null, version: 1 };
const worker = { id: '0191f3d2-7f5b-7abc-8b2e-123456789b03', displayName: 'batch-a100-01', role: 'BATCH_MEDIA', provider: 'EzyCloudX', providerInstanceId: 'ctr-77aa02', mode: 'MANUAL_REGISTERED', desiredStatus: 'ACTIVE', observedStatus: 'BUSY', expectedGpuModel: 'NVIDIA A100', expectedVramMb: 24576, approvedImage: image, currentSession: { id: '0191f3d2-7f5b-7abc-8b2e-123456789b04', sessionNonce: '0191f3d2-7f5b-7abc-8b2e-123456789b05', imageDigest: image.imageDigest, agentVersion: '1.8.2', contractVersion: 1, gpuInventory: [{ model: 'NVIDIA A100', vramMb: 24576 }], cpuInventory: {}, capacity: { totalSlots: 4, availableSlots: 2 }, telemetry: {}, currentTaskCount: 2, lastHeartbeatSequence: '42', startedAt: new Date().toISOString(), lastHeartbeatAt: new Date().toISOString() }, activeLeaseCount: 2, safeToTerminate: false, billing: { estimatedCostCp: '13000', paidVndPerCp: '1' }, lastError: null, version: 3, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
async function fulfill(route: Route, data: unknown) { return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data, meta: { requestId } }) }); }
async function mockWorkers(page: Page) { await page.route('**/v1/worker-events', (route) => route.fulfill({ contentType: 'text/event-stream', body: '' })); await page.route('**/v1/worker-images', (route) => fulfill(route, { items: [image], nextCursor: null })); await page.route('**/v1/workers?**', (route) => fulfill(route, { items: [worker], nextCursor: null })); await page.route('**/v1/workers/*', (route) => fulfill(route, worker)); }

test('browses GPU Worker capacity and shutdown guidance accessibly', async ({ page }) => {
  await mockWorkers(page); await page.goto('/workers');
  await expect(page.getByText('batch-a100-01')).toBeVisible();
  await page.getByRole('button', { name: 'Xem chi tiết' }).click();
  await expect(page.getByRole('heading', { name: 'Shutdown an toàn' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
});

test('GPU Workers has no horizontal overflow on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 }); await mockWorkers(page); await page.goto('/workers');
  await expect(page.getByText('batch-a100-01')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
