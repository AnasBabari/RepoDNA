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
    // Regression: JSX whitespace between flex children is stripped; the count
    // must read as a proper sentence for screen readers ("scanned 1,234 public"),
    // never "scanned1,234public".
    await expect(counter).toHaveText(/RepoDNA has scanned 1,234 public repositories/);
    await expect(page.locator('.browser-retention-toggle')).toHaveCount(0);
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
    let finishAnalysis!: () => void;
    const analysisGate = new Promise<void>((resolve) => { finishAnalysis = resolve; });
    await page.route('**/api/v2/analyses', async (route) => {
      await analysisGate;
      await route.fulfill({
        status: 429, contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many analysis requests.', retryAfter: 60 } }),
      });
    });
    // This failure path must never depend on GitHub or fall through to a live scan.
    await page.route('**/api/analyze', (route) => route.fulfill({
      status: 429, contentType: 'application/json',
      body: JSON.stringify({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many analysis requests.' } }),
    }));
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
    await page.getByRole('button', { name: 'Analyze repository', exact: true }).click();
    // Should enter analyzing state without throwing
    await expect(page.getByTestId('analysis-progress')).toBeVisible({ timeout: 5000 });
    finishAnalysis();
    await expect(page.getByText('We couldn’t complete this analysis.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try Again', exact: true })).toBeVisible();
  });

  test('coalesces slow refreshes from focus and visibility without an error overlay', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let callCount = 0;
    let finishRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => { finishRefresh = resolve; });
    await page.route('/api/stats', async (route) => {
      callCount += 1;
      if (callCount > 1) await refreshGate;
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ scannedRepositories: callCount === 1 ? 7 : 8, updatedAt: new Date().toISOString() }) });
    });
    await page.goto('/');
    await expect(page.getByTestId('scan-counter-count')).toHaveText('7');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => callCount).toBe(2);
    await page.evaluate(() => {
      for (let i = 0; i < 20; i += 1) {
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new CustomEvent('repodna:analysis-complete'));
      }
    });
    // Leave the in-flight response pending long enough to catch duplicate starts.
    await page.waitForTimeout(300);
    expect(callCount).toBe(2);
    await expect(page.getByTestId('scan-counter-count')).toHaveText('7');
    finishRefresh();
    await expect(page.getByTestId('scan-counter-count')).toHaveText('8');
    expect(errors).toEqual([]);
  });

  test('keeps the last valid count through a temporary HTTP failure', async ({ page }) => {
    let callCount = 0;
    await page.route('/api/stats', (route) => {
      callCount += 1;
      return route.fulfill({ status: callCount === 2 ? 503 : 200, contentType: 'application/json',
        body: JSON.stringify(callCount === 2 ? { scannedRepositories: null, unavailable: true }
          : { scannedRepositories: callCount === 1 ? 7 : 9, updatedAt: new Date().toISOString() }) });
    });
    await page.goto('/');
    await expect(page.getByTestId('scan-counter-count')).toHaveText('7');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => callCount).toBe(2);
    await expect(page.getByTestId('scan-counter-count')).toHaveText('7');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('repodna:analysis-complete')));
    await expect(page.getByTestId('scan-counter-count')).toHaveText('9');
  });

  test('refreshes on the actual 30-second polling timer', async ({ page }) => {
    await page.clock.install();
    let callCount = 0;
    await page.route('/api/stats', (route) => {
      callCount += 1;
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ scannedRepositories: callCount, updatedAt: new Date().toISOString() }) });
    });
    await page.goto('/');
    await expect(page.getByTestId('scan-counter-count')).toHaveText('1');
    await page.clock.fastForward(30_000);
    await expect(page.getByTestId('scan-counter-count')).toHaveText('2');
  });

  test('unmounts with a slow request pending without an unhandled rejection', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route('/api/stats', async (route) => {
      calls += 1;
      if (calls > 1) await gate;
      try {
        await route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ scannedRepositories: 7, updatedAt: new Date().toISOString() }) });
      } catch {
        // The component intentionally aborts the pending browser request.
      }
    });
    await page.goto('/');
    await expect(page.getByTestId('scan-counter-count')).toHaveText('7');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => calls).toBe(2);
    await page.getByRole('button', { name: 'Try Demo Project', exact: true }).click();
    await expect(page.getByTestId('scan-counter')).toHaveCount(0);
    release();
    await expect(page.getByRole('button', { name: /Code Graph/ })).toBeVisible();
    expect(errors).toEqual([]);
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
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/api/auth/session');
    await page.waitForTimeout(300);
    // Filter out unrelated errors — stats counter should not produce unhandled rejections
    expect(errors).toHaveLength(0);
  });
});
