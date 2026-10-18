import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) => {
    if (baseURL && route.request().url().startsWith(baseURL)) return route.continue();
    return route.abort();
  });
});

test('dark split landing shows actual, bounded sample relationships and opens the workspace', async ({ page }) => {
  const sample = JSON.parse(readFileSync('public/samples/nanogpt.json', 'utf8')) as {
    nodes: { id: string }[]; edges: { id: string; source: string; target: string | null }[];
  };
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Understandthe shape ofany codebase.');
  await expect(page.locator('.preview-warning')).toHaveText('444 unresolved links');
  await expect(page.locator('.preview-canvas .react-flow__node')).toHaveCount(7);
  const ids = await page.locator('.preview-canvas .react-flow__node').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')));
  expect(ids.every((id) => sample.nodes.some((node) => node.id === id))).toBe(true);
  const edges = await page.locator('.preview-canvas .react-flow__edge').evaluateAll((links) => links.map((link) => link.getAttribute('data-id')));
  expect(edges.length).toBeGreaterThan(0);
  expect(edges.length).toBeLessThanOrEqual(6);
  expect(edges.every((id) => sample.edges.some((edge) => edge.id === id && ids.includes(edge.source) && ids.includes(edge.target)))).toBe(true);
  await expect(page.locator('main')).toHaveCSS('background-color', 'rgb(16, 20, 24)');
  await expect(page.getByText('Go (experimental).', { exact: false })).toBeVisible();
  await expect(page.getByText('Explore bundled snapshots. These are not fresh scans.')).toBeVisible();
  await page.getByRole('button', { name: 'Explore snapshot' }).click();
  await expect(page.locator('.workspace')).toBeVisible({ timeout: 60_000 });
  for (const name of ['Overview', 'Architecture', 'Routes & trace', 'Dependencies', 'Files & symbols', 'Code Graph']) {
    await expect(page.locator(`.sidebar button[title="${name}"]`)).toBeVisible();
  }
});

for (const width of [390, 820, 1024]) {
  test(`landing sources remain readable and reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.locator('.preview-warning')).toBeVisible();
    await expect(page.locator('.landing-repository-form')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
    for (const selector of ['.landing-repository-form', '.landing-source-actions', '.sample-preview']) {
      const bounds = await page.locator(selector).boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    await page.getByRole('group', { name: 'Repository sources' }).getByRole('button', { name: 'GitHub repository', exact: true }).press('Enter');
    await expect(page.getByRole('textbox', { name: 'GitHub repository URL' })).toBeFocused();
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'ZIP or JSON', exact: true }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles('public/samples/nanogpt.json');
    await expect(page.locator('.workspace')).toBeVisible({ timeout: 60_000 });
  });
}

test('preview failure does not block imports or show an unhandled rejection', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/samples/nanogpt.json', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: 'Preview unavailable' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analyze repository', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Try Demo Project', exact: true }).click();
  await expect(page.locator('.workspace')).toBeVisible({ timeout: 60_000 });
  expect(errors).toEqual([]);
});
