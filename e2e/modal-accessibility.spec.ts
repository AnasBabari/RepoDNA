import { expect, test, type Locator, type Page } from '@playwright/test';

async function assertTrap(page: Page, dialog: Locator) {
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  const focusInside = () => dialog.evaluate((element) => element.contains(document.activeElement));
  await expect.poll(focusInside).toBe(true);
  for (let index = 0; index < 25; index++) {
    await page.keyboard.press(index % 3 === 0 ? 'Shift+Tab' : 'Tab');
    expect(await focusInside()).toBe(true);
  }
  expect(await page.getByRole('button', { name: 'Feedback', exact: true, includeHidden: true }).evaluate((element) => Boolean(element.closest('[inert]')))).toBe(true);
}

for (const width of [390, 1440]) test(`modal keyboard lifecycle and private reconnect at ${width}px`, async ({ page, baseURL }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.route('**/*', (route) => baseURL && route.request().url().startsWith(baseURL) ? route.continue() : route.abort());
  await page.route('**/api/auth/session', (route) => route.fulfill({ json: { user: { id: 'test', name: 'Test user' } } }));
  await page.route('**/api/github/repositories?**', (route) => route.fulfill({ status: 401, json: { success: false, error: { code: 'UNAUTHORIZED' } } }));
  await page.goto('/');
  const privateTrigger = page.getByRole('button', { name: 'Test user · Repositories' });
  await privateTrigger.focus();
  await page.keyboard.press('Enter');
  let dialog = page.getByRole('dialog', { name: 'Your GitHub Repositories (Beta)', exact: true });
  await expect(dialog.getByRole('button', { name: /Reconnect/i })).toBeVisible();
  await assertTrap(page, dialog);
  await page.keyboard.press('Escape');
  await expect(privateTrigger).toBeFocused();
  const feedback = page.getByRole('button', { name: 'Feedback', exact: true });
  await feedback.focus();
  await page.keyboard.press('Enter');
  dialog = page.getByRole('dialog', { name: 'RepoDNA Feedback & Beta Survey' });
  await assertTrap(page, dialog);
  await dialog.getByRole('button', { name: 'Close survey' }).click();
  await expect(feedback).toBeFocused();
  await page.goto('/?sample=https://github.com/karpathy/nanoGPT');
  const newAnalysis = page.getByRole('button', { name: 'New Analysis', exact: true });
  await newAnalysis.focus();
  await page.keyboard.press('Enter');
  dialog = page.getByRole('dialog', { name: 'Map a repository' });
  await assertTrap(page, dialog);
  await page.keyboard.press('Escape');
  await expect(newAnalysis).toBeFocused();
  expect(await newAnalysis.evaluate((element) => Boolean(element.closest('[inert]')))).toBe(false);
});
