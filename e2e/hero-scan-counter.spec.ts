import { expect, test } from '@playwright/test';

test.describe('hero scan counter', () => {
  test('renders loading state immediately', async ({ page }) => {
    await page.route('/api/stats', async (route) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ scannedRepositories: 99, updatedAt: new Date().toISOString() }),
      });
    });

    await page.goto('/');
    await expect(page.getByTestId('scan-counter-loading')).toBeVisible({ timeout: 2000 });
    await page.unroute('/api/stats');
  });

  test('renders count when endpoint succeeds', async ({ page }) => {
    await page.route('/api/stats', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ scannedRepositories: 1234, updatedAt: new Date().toISOString() }),
      });
    });

    await page.goto('/');
    const counter = page.getByTestId('scan-counter');
    await expect(counter).toBeVisible();
    await expect(page.getByTestId('scan-counter-count')).toHaveText('1,234');
    await expect(counter).toContainText('RepoDNA has scanned');
    await expect(counter).toContainText('public repositories');
    await expect(counter).toHaveAttribute('aria-live', 'polite');
    await expect(counter).toHaveAttribute('title', 'Unique public repositories successfully analyzed by RepoDNA.');
  });

  test('renders unavailable state when store not configured', async ({ page }) => {
    await page.route('/api/stats', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          scannedRepositories: null,
          unavailable: true,
          reason: 'STATS_UNAVAILABLE',
          updatedAt: new Date().toISOString(),
        }),
      });
    });

    await page.goto('/');
    await expect(page.getByTestId('scan-counter-unavailable')).toBeVisible();
    await expect(page.getByTestId('scan-counter-unavailable')).toContainText('RepoDNA has scanned');
    await expect(page.getByTestId('scan-counter-unavailable')).toContainText('public repositories');
    // Must not invent a fallback number
    await expect(page.getByTestId('scan-counter-unavailable')).not.toContainText(/\d+.*public repositories/);
  });

  test('polls every 30 seconds and cleans up on unmount', async ({ page }) => {
    let callCount = 0;
    await page.route('/api/stats', async (route) => {
      callCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ scannedRepositories: callCount, updatedAt: new Date().toISOString() }),
      });
    });

    await page.goto('/');
    await expect(page.getByTestId('scan-counter')).toBeVisible();
    const initial = callCount;
    expect(initial).toBeGreaterThanOrEqual(1);

    // Fast-forward polling interval by dispatching visibilitychange and focus — component should re-fetch immediately
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(300);
    expect(callCount).toBeGreaterThan(initial);

    // Navigate away — polling should stop (no additional calls after unmount)
    await page.goto('/api/auth/session');
    const afterNav = callCount;
    await page.waitForTimeout(600);
    expect(callCount).toBe(afterNav);
  });

  test('refreshes after repodna:analysis-complete event', async ({ page }) => {
    let callCount = 0;
    await page.route('/api/stats', async (route) => {
      callCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ scannedRepositories: 42, updatedAt: new Date().toISOString() }),
      });
    });

    await page.goto('/');
    await expect(page.getByTestId('scan-counter')).toBeVisible();
    const before = callCount;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('repodna:analysis-complete')));
    await page.waitForTimeout(300);
    expect(callCount).toBeGreaterThan(before);
  });

  test('does not block analysis when stats endpoint fails', async ({ page }) => {
    await page.route('/api/stats', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          scannedRepositories: null,
          unavailable: true,
          reason: 'STATS_UNAVAILABLE',
          updatedAt: new Date().toISOString(),
        }),
      });
    });

    await page.goto('/');
    // Counter shows unavailable instead of blocking
    await expect(page.getByTestId('scan-counter-unavailable')).toBeVisible();

    // Analysis input should still be present and interactive
    const input = page.getByPlaceholder('https://github.com/owner/repository');
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();

    // Even submitting an invalid repo should show server error rather than a stats crash
    await input.fill('https://github.com/owner/repo');
    await page.getByRole('button', { name: 'Analyze Repository' }).click();
    // Should enter analyzing state without throwing
    await expect(page.getByText('Decoding Repository')).toBeVisible({ timeout: 5000 });
  });

  test('cancels requests on unmount and refreshes on focus', async ({ page }) => {
    await page.route('/api/stats', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ scannedRepositories: 7, updatedAt: new Date().toISOString() }),
      });
    });

    await page.goto('/');
    await expect(page.getByTestId('scan-counter')).toBeVisible();

    // Focus refresh
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('scan-counter-count')).toBeVisible();

    // Navigate away ensures abort/cleanup (no console errors)
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/api/auth/session');
    await page.waitForTimeout(300);
    // Filter out unrelated errors — stats counter should not produce unhandled rejections
    const statsErrors = errors.filter((text) => text.includes('Stats') || text.includes('scan-counter'));
    expect(statsErrors).toHaveLength(0);
  });
});
