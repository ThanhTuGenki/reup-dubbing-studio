import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const requestId = '0191f3d2-7f5b-7abc-8b2e-123456789abd';
const pipeline = { targetLanguage: 'vi', defaultVoiceProfileId: null, voiceMode: 'SINGLE', subtitleLanguage: 'vi', subtitleFilenameRule: '{slug}.vi.srt', subtitleMaxLineLength: 42, ttsSpeed: 1, timingPolicy: 'FIT_SEGMENT', output16x9Enabled: true, output9x16Enabled: false };
const channel = { id: '0191f3d2-7f5b-7abc-8b2e-123456789ac0', name: 'Kênh Việt hóa', status: 'ACTIVE', pipeline, content: { voiceRules: {}, ctaTemplate: null, metadataTemplate: {}, baseKeywords: [] }, destinations: [], assets: [], readiness: 'READY', readinessIssues: [], version: 3, createdAt: '2026-09-18T08:00:00.000Z', updatedAt: '2026-09-20T08:00:00.000Z' };
const series = { id: '0191f3d2-7f5b-7abc-8b2e-123456789ac1', channelProfileId: channel.id, name: 'Tổng tài tập ngắn', status: 'ACTIVE', overrides: { targetLanguage: null, defaultVoiceProfileId: null, voiceMode: null, subtitleLanguage: null, subtitleFilenameRule: null, subtitleMaxLineLength: null, ttsSpeed: 1.1, timingPolicy: null, output16x9Enabled: null, output9x16Enabled: true }, effectiveConfig: { ...pipeline, ttsSpeed: 1.1, output9x16Enabled: true }, inheritance: { targetLanguage: 'CHANNEL', defaultVoiceProfileId: 'CHANNEL', voiceMode: 'CHANNEL', subtitleLanguage: 'CHANNEL', subtitleFilenameRule: 'CHANNEL', subtitleMaxLineLength: 'CHANNEL', ttsSpeed: 'SERIES', timingPolicy: 'CHANNEL', output16x9Enabled: 'CHANNEL', output9x16Enabled: 'SERIES' }, mask: { x: 0.1, y: 0.8, width: 0.8, height: 0.1 }, assets: [], readiness: 'READY', readinessIssues: [], version: 2, parentVersion: 3, createdAt: '2026-09-19T08:00:00.000Z', updatedAt: '2026-09-20T09:00:00.000Z' };
const reviewPolicy = { ownerType: 'CHANNEL', ownerProfileId: channel.id, stored: { castGate: 'NOT_REQUIRED', scriptGate: 'MANUAL_REQUIRED', ttsGate: 'MANUAL_REQUIRED', renderGate: 'MANUAL_REQUIRED', publishContentGate: 'MANUAL_REQUIRED', autoRequestRender: false }, effective: { castGate: 'NOT_REQUIRED', scriptGate: 'MANUAL_REQUIRED', ttsGate: 'MANUAL_REQUIRED', renderGate: 'MANUAL_REQUIRED', publishContentGate: 'MANUAL_REQUIRED', autoRequestRender: false }, inheritance: { castGate: 'CHANNEL', scriptGate: 'CHANNEL', ttsGate: 'CHANNEL', renderGate: 'CHANNEL', publishContentGate: 'CHANNEL', autoRequestRender: 'CHANNEL' }, version: 2, parentPolicyVersion: null, updatedAt: '2026-09-20T09:00:00.000Z' };

async function mockProfiles(page: Page) {
  await page.route('**/v1/channel-profiles**', (route) => {
    const detail = /channel-profiles\/[^?]+$/u.test(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { ...(detail ? { ETag: '"3"', 'Access-Control-Expose-Headers': 'ETag' } : {}), 'X-Request-Id': requestId }, body: JSON.stringify({ data: detail ? channel : { items: [channel], nextCursor: null }, meta: { requestId } }) });
  });
  await page.route('**/v1/series-profiles**', (route) => {
    const detail = /series-profiles\/[^?]+$/u.test(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { ...(detail ? { ETag: '"2:3"', 'Access-Control-Expose-Headers': 'ETag' } : {}), 'X-Request-Id': requestId }, body: JSON.stringify({ data: detail ? series : { items: [series], nextCursor: null }, meta: { requestId } }) });
  });
  await page.route('**/v1/channel-profiles/*/review-policy', async (route) => {
    const patch = route.request().method() === 'PATCH' ? await route.request().postDataJSON() as Record<string, unknown> : {};
    const next = { ...reviewPolicy, stored: { ...reviewPolicy.stored, ...patch }, effective: { ...reviewPolicy.effective, ...patch }, version: route.request().method() === 'PATCH' ? 3 : 2 };
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { ETag: route.request().method() === 'PATCH' ? '"3"' : '"2"', 'Access-Control-Expose-Headers': 'ETag', 'X-Request-Id': requestId }, body: JSON.stringify({ data: next, meta: { requestId } }) });
  });
}

test('browses Channel and Series profiles with inheritance detail', async ({ page }) => {
  await mockProfiles(page);
  await page.goto('/channel-profiles');
  await expect(page.getByRole('heading', { name: 'Channel & Series Profiles' })).toBeVisible();
  await expect(page.getByText('Kênh Việt hóa')).toBeVisible();
  await page.getByRole('tab', { name: 'Series Profiles' }).click();
  await page.getByText('Tổng tài tập ngắn').click();
  await expect(page.getByText('Ghi đè').first()).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
});

test('Profiles list remains usable without horizontal page overflow on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await mockProfiles(page);
  await page.goto('/channel-profiles');
  await expect(page.getByText('Kênh Việt hóa')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('opens and edits Review Policy without mobile overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await mockProfiles(page);
  await page.goto('/channel-profiles');
  await page.getByText('Kênh Việt hóa').click();
  await page.getByRole('link', { name: 'Điểm duyệt' }).click();
  await expect(page.getByRole('heading', { name: 'Tự động hóa & điểm duyệt' })).toBeVisible();
  await page.getByLabel('Điểm duyệt Audio TTS').click();
  await page.getByRole('option', { name: 'Không cần duyệt' }).click();
  const patchRequest = page.waitForRequest((request) => request.method() === 'PATCH' && request.url().endsWith('/review-policy'));
  await page.getByRole('button', { name: 'Áp dụng chính sách' }).click();
  expect(await (await patchRequest).postDataJSON()).toEqual({ ttsGate: 'NOT_REQUIRED' });
  await expect(page.getByText('Policy đang đồng bộ với Control Plane')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
});
