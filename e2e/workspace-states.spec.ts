import { expect, test } from '@playwright/test';

const STRIX_URL = '/?repo=https://github.com/usestrix/strix';

test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (baseURL && url.startsWith(baseURL)) return route.continue();
    return route.abort();
  });
});

test('explains when a repository has no statically detected HTTP routes', async ({ page }) => {
  await page.goto(STRIX_URL);
  await expect(page.getByRole('button', { name: /Routes & trace/ })).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: /Routes & trace/ }).click();

  await expect(page.locator('.route-empty-state')).toBeVisible();
  await expect(page.locator('.route-empty-state h2')).toHaveText('No HTTP routes detected');
  await expect(page.locator('.route-empty-state')).toContainText('libraries, CLIs, SDKs');
  await expect(page.locator('.table-head')).toHaveCount(0);
  await expect(page.locator('.trace-empty-state')).toContainText('A trace appears here');
});

test('shows dependency cycles as bounded, directed findings', async ({ page }) => {
  await page.goto(STRIX_URL);
  await expect(page.getByRole('button', { name: /Dependencies/ })).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: /Dependencies/ }).click();

  const panel = page.locator('.cycle-panel');
  await expect(panel).toBeVisible();
  const rows = panel.locator('.cycle-row');
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);
  expect(rowCount).toBeLessThanOrEqual(6);

  for (let index = 0; index < rowCount; index++) {
    const path = (await rows.nth(index).locator('code').textContent() ?? '').split(' → ');
    expect(path.length).toBeGreaterThan(2);
    expect(new Set(path.slice(0, -1)).size).toBe(path.length - 1);
    expect(path[0]).toBe(path[path.length - 1]);
  }
});
