import { chromium, expect, test } from '@playwright/test';
import path from 'node:path';

test('long repository names and controls reflow at actual 200% browser zoom', async ({ baseURL }, testInfo) => {
  const extension = path.resolve('e2e/fixtures/zoom-extension');
  const longName = 'a-very-long-repository-name-with-many-components-and-shared-packages'.repeat(2);
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    await context.route('**/*', (route) => baseURL && route.request().url().startsWith(baseURL) ? route.continue() : route.abort());
    await context.route('**/samples/nanogpt.json', async (route) => {
      const response = await route.fetch();
      const project = await response.json();
      project.repository.name = longName;
      await route.fulfill({ json: project });
    });
    const page = context.pages()[0];
    await page.goto(`${baseURL}/?sample=https://github.com/karpathy/nanoGPT`);
    await expect(page.locator('.workspace')).toBeVisible();
    await expect(page.locator('.repo-pill')).toContainText(longName);
    const initialWidth = await page.evaluate(() => innerWidth);
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const zoom = await worker.evaluate(async (origin) => {
      const api = (globalThis as unknown as { chrome: { tabs: {
        query: (query: object) => Promise<{ id: number; url?: string }[]>;
        setZoom: (id: number, factor: number) => Promise<void>;
        getZoom: (id: number) => Promise<number>;
      } } }).chrome.tabs;
      const tab = (await api.query({})).find((entry) => entry.url?.startsWith(origin!));
      if (!tab) throw new Error('Test tab not found');
      await api.setZoom(tab.id, 2);
      return api.getZoom(tab.id);
    }, baseURL);
    expect(zoom).toBe(2);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(initialWidth * 0.6);
    for (const view of ['Architecture', 'Code Graph']) {
      await page.getByRole('navigation', { name: 'Workspace views' }).getByRole('button', { name: view, exact: true }).click();
      const controls = page.locator('.view-heading button, .topbar button');
      for (const control of await controls.all()) {
        if (!await control.isVisible()) continue;
        const bounds = await control.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      // Viewport capture preserves the physical 200% view; fullPage crops at CSS dimensions in Chromium.
      await page.screenshot({ path: testInfo.outputPath(`${view.replaceAll(' ', '-')}-200-percent.png`), fullPage: false });
    }
  } finally { await context.close(); }
});
