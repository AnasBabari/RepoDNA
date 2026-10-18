import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) => baseURL && route.request().url().startsWith(baseURL) ? route.continue() : route.abort());
});

for (const key of ['Enter', 'Space']) test(`${key} inspects and expands the focused graph node and returns focus`, async ({ page }) => {
  await page.goto('/?sample=https://github.com/karpathy/nanoGPT');
  await page.getByRole('button', { name: 'Code Graph', exact: true }).click();
  const node = page.locator('.code-node').first();
  await expect(node).toBeVisible();
  const name = await node.getAttribute('aria-label');
  expect(name).toMatch(/^[a-z_]+: .+ — .+:\d+$/);
  await node.focus();
  const nodeId = await node.locator('..').getAttribute('data-id');
  const before = await page.locator('.code-node').count();
  await page.keyboard.press(key);
  const detail = page.getByRole('complementary', { name: 'Node details' });
  await expect(detail).toBeFocused();
  expect(await page.locator('.code-node').count()).toBeGreaterThanOrEqual(before);
  await page.keyboard.press('Tab');
  await expect(detail.getByRole('button', { name: 'Close node details' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(detail).toHaveCount(0);
  await expect(page.locator(`.react-flow__node[data-id="${nodeId}"] .code-node`)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(detail).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
});
