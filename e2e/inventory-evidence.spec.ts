import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) => baseURL && route.request().url().startsWith(baseURL) ? route.continue() : route.abort());
});
test('real ZIP analysis excludes Makefiles from source coverage and presents manifest-backed declarations', async ({ page }) => {
  const entries = Object.fromEntries(Array.from({ length: 37 }, (_, n) => [`requests/src/module${n}.py`, strToU8('import urllib3\n\ndef parse():\n    pass\n')]));
  for (let n = 0; n < 8; n++) entries[`requests/build${n}/Makefile`] = strToU8('all:\n\techo never executed\n');
  entries['requests/pyproject.toml'] = strToU8('[project]\nname="requests-like"\ndependencies=["urllib3", "charset-normalizer", "certifi", "idna"]\n');
  await page.goto('/');
  await expect(page.locator('.preview-warning')).toBeVisible();
  await page.locator('input[accept=".zip,application/zip,.json,application/json"]').setInputFiles({ name: 'requests-like.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(entries)) });
  await expect(page.locator('.workspace')).toBeVisible({ timeout: 60_000 });
  const evidence = page.getByRole('region', { name: 'Inventory evidence' });
  await expect(evidence).toContainText('Supported source: 37 complete + 0 partial + 0 failed + 0 skipped + 0 unprocessed = 37');
  await expect(evidence).toContainText('evidence files: 9');
  await expect(page.getByRole('region', { name: 'Scan coverage', exact: true })).toContainText('100% supported source parsed (including partial)');
  await evidence.locator('summary').click();
  await expect(evidence).toContainText('urllib3');
  await expect(evidence).toContainText('pyproject.toml');
  await page.getByRole('button', { name: 'Technical', exact: false }).click();
  const coverage = page.getByRole('region', { name: 'Scan coverage details' });
  await expect(coverage).toContainText('100% supported source parsed (including partial)');
  await expect(coverage.locator('.coverage-grid > div').filter({ has: page.getByText('Unsupported source', { exact: true }) })).toHaveText('Unsupported source0');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'TXT', exact: true }).click();
  const report = readFileSync((await (await downloadPromise).path())!, 'utf8');
  expect(report).toContain('Packages/workspaces:       1');
  expect(report).toContain('Declared dependencies:     4');
  expect(report).toContain('37 complete + 0 partial + 0 failed + 0 skipped + 0 unprocessed = 37');
});
test('older snapshots disclose unavailable manifest evidence instead of proxy counts', async ({ page }) => {
  await page.goto('/?repo=https://github.com/karpathy/nanoGPT');
  const evidence = page.getByRole('region', { name: 'Inventory evidence' });
  await expect(evidence).toContainText('older snapshots cannot establish these counts');
  await expect(evidence).toContainText('Legacy source accounting');
  await expect(evidence.locator('.coverage-grid > div').first()).toHaveText('Package rootsNot recorded');
});
