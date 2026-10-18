import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { installRevisionHarness, REVISION_REPO, REVISION_SHA } from './helpers/revision-harness';

test('a bundled snapshot discloses its old commit and Analyze latest runs fresh source', async ({ page, baseURL }) => {
  const calls = await installRevisionHarness(page, baseURL, ['HEAD']);
  await page.addInitScript(() => { (window as Window & { scanEvents: number }).scanEvents = 0; window.addEventListener('repodna:analysis-complete', () => (window as Window & { scanEvents: number }).scanEvents++); });
  const sample = JSON.parse(readFileSync('public/samples/nanogpt.json', 'utf8'));
  await page.goto(`/?sample=${REVISION_REPO}`);
  const notice = page.getByRole('region', { name: 'Bundled snapshot provenance' });
  await expect(notice).toContainText(sample.generatedAt);
  await expect(notice).toContainText(sample.repository.commitSha);
  expect(calls.submitted).toEqual([]);
  expect(await page.evaluate(() => (window as Window & { scanEvents: number }).scanEvents)).toBe(0);
  await notice.getByRole('button', { name: 'Analyze latest', exact: true }).click();
  await expect(page.locator('.snapshot-provenance')).toContainText(REVISION_SHA, { timeout: 60_000 });
  await expect(notice).toHaveCount(0);
  expect(calls.refs).toEqual(['HEAD']);
});

test('normal featured URL input does not substitute its bundled snapshot', async ({ page, baseURL }) => {
  const calls = await installRevisionHarness(page, baseURL, ['HEAD']);
  await page.goto(`/?repo=${REVISION_REPO}`);
  await expect(page.locator('.snapshot-provenance')).toContainText(REVISION_SHA, { timeout: 60_000 });
  await expect(page.getByRole('region', { name: 'Bundled snapshot provenance' })).toHaveCount(0);
  expect(calls.refs).toEqual(['HEAD']);
  expect(calls.submitted.map((call) => call.url)).toEqual([REVISION_REPO, REVISION_REPO]);
});

for (const invalid of [false, true]) test(`${invalid ? 'invalid' : 'missing'} snapshots fail explicitly and retry without silently scanning GitHub`, async ({ page, baseURL }) => {
  const calls = await installRevisionHarness(page, baseURL, []);
  await page.route('**/samples/nanogpt.json', (route) => route.fulfill({ status: invalid ? 200 : 404, json: {} }));
  await page.goto(`/?sample=${REVISION_REPO}`);
  await expect(page.getByText('This bundled snapshot is unavailable or invalid.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Try Again', exact: true }).click();
  await expect(page.getByText('This bundled snapshot is unavailable or invalid.', { exact: false })).toBeVisible();
  expect(calls.refs).toEqual([]);
  expect(calls.submitted).toEqual([]);
});
