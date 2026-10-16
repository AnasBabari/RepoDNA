import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) => {
    if (baseURL && route.request().url().startsWith(baseURL)) return route.continue();
    return route.abort();
  });
});

async function expectExpressFiles(page: Page) {
  await expect(page.locator('.workspace')).toBeVisible({ timeout: 60_000 });
  await page.locator('.sidebar button[title="Files & symbols"]').click();
  await expect(page.locator('.file-table')).toContainText('app.js');
  await expect(page.locator('.file-table')).toContainText('user_service.js');
  await expect(page.locator('.file-table')).toContainText('users.js');
}

test('local folder action preserves the selected files through the analysis lifecycle', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.preview-warning')).toBeVisible();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Local folder', exact: true }).click();
  await (await chooserPromise).setFiles(resolve('tests/fixtures/express-basic'));
  await expectExpressFiles(page);
});

test('ZIP action analyzes actual source files rather than importing precomputed JSON', async ({ page }) => {
  const entries = Object.fromEntries(['package.json', 'src/app.js', 'src/services/user_service.js', 'src/routes/users.js']
    .map((path) => [path, readFileSync(resolve('tests/fixtures/express-basic', path))]));
  await page.goto('/');
  await expect(page.locator('.preview-warning')).toBeVisible();
  await page.locator('input[accept=".zip,application/zip,.json,application/json"]').setInputFiles({
    name: 'express-fixture.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(entries)),
  });
  await expectExpressFiles(page);
});
