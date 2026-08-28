import { expect, test, type Page } from '@playwright/test';

const SAMPLE_URL = '/?repo=https://github.com/karpathy/nanoGPT';

test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (baseURL && url.startsWith(baseURL)) return route.continue();
    return route.abort();
  });
});

async function loadWorkspace(page: Page) {
  await page.goto(SAMPLE_URL);
  await expect(page.locator('.workspace')).toBeVisible({ timeout: 60_000 });
}

test.describe('mobile workspace', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps every workspace view reachable when the sidebar is hidden', async ({ page }) => {
    await loadWorkspace(page);

    const navigation = page.getByRole('navigation', { name: 'Workspace views' });
    await expect(navigation.getByRole('button', { name: 'Code Graph', exact: true })).toBeVisible();
    await expect(navigation.getByRole('button', { name: 'Dependencies', exact: true })).toBeVisible();
    await expect(navigation.getByRole('button', { name: 'Files & symbols', exact: true })).toBeVisible();

    await navigation.getByRole('button', { name: 'Code Graph', exact: true }).click();
    await expect(page.locator('.code-graph-container h1')).toHaveText('Code Graph');
    await expect(page.locator('.react-flow__node[data-id]').first()).toBeVisible({ timeout: 30_000 });

    await navigation.getByRole('button', { name: 'Files & symbols', exact: true }).click();
    await expect(page.locator('.files-view h1')).toHaveText('Files & symbols');
    await expect(page.locator('.file-table')).toBeVisible();
  });

  test('opens and closes the selected-item detail sheet', async ({ page }) => {
    await loadWorkspace(page);
    const navigation = page.getByRole('navigation', { name: 'Workspace views' });
    await navigation.getByRole('button', { name: 'Architecture', exact: true }).click();
    const node = page.locator('.architecture-view .react-flow__node').first();
    await expect(node).toBeVisible({ timeout: 30_000 });
    await node.click();

    const sheet = page.getByRole('dialog', { name: 'Selected repository details' });
    await expect(sheet).toBeVisible();
    const bounds = await sheet.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await sheet.getByRole('button', { name: 'Close details' }).click();
    await expect(sheet).toBeHidden();
  });
});

test.describe('tablet workspace', () => {
  test.use({ viewport: { width: 1024, height: 900 } });

  test('replaces the hidden inspector with the detail sheet', async ({ page }) => {
    await loadWorkspace(page);
    await page.locator('.sidebar').locator('button[title="Architecture"]').click();
    const node = page.locator('.architecture-view .react-flow__node').first();
    await expect(node).toBeVisible({ timeout: 30_000 });
    await node.click();
    await expect(page.getByRole('dialog', { name: 'Selected repository details' })).toBeVisible();
    await expect(page.locator('.detail-panel:visible')).toHaveCount(1);
  });
});
