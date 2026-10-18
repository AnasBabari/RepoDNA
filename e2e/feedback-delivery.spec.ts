import { expect, test } from '@playwright/test';

for (const failure of ['offline', '400', '429', '503', 'unconfirmed']) test(`feedback preserves choices and retries after ${failure}`, async ({ page, baseURL }) => {
  await page.route('**/*', (route) => baseURL && route.request().url().startsWith(baseURL) ? route.continue() : route.abort());
  const submissions: Record<string, unknown>[] = [];
  await page.route('**/api/feedback', (route) => {
    submissions.push(route.request().postDataJSON());
    if (submissions.length > 1) return route.fulfill({ json: { success: true } });
    if (failure === 'offline') return route.abort('internetdisconnected');
    return route.fulfill({ status: failure === 'unconfirmed' ? 200 : Number(failure), json: { success: false } });
  });
  await page.goto('/');
  await expect(page.locator('.preview-canvas .react-flow__node').first()).toBeVisible();
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'RepoDNA Feedback & Beta Survey' });
  await expect(dialog.locator('textarea')).toHaveCount(0);
  await expect(dialog).toContainText('anonymous daily counts');
  await dialog.getByRole('button', { name: '★ 3', exact: true }).click();
  await dialog.getByRole('radio', { name: 'Refactoring & change impact analysis' }).check();
  const capability = dialog.getByRole('button', { name: /Export diagrams to SVG/ });
  await capability.click();
  await dialog.getByRole('button', { name: 'Submit Feedback' }).click();
  await expect(dialog.getByRole('alert')).toContainText('selections are preserved');
  await expect(dialog.getByRole('button', { name: '★ 3', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(capability).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('radio', { name: 'Refactoring & change impact analysis' })).toBeChecked();
  await expect(page.getByRole('heading', { name: 'Thank You!' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Submit Feedback' }).click();
  await expect(page.getByRole('dialog', { name: 'Thank You!' })).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toEqual(submissions[0]);
  expect(submissions[0]).toMatchObject({ usefulnessScore: 3, primaryUsecase: 'refactoring', missingCapabilities: ['diagram_export'], submissionId: expect.any(String) });
  expect(submissions[0]).not.toHaveProperty('comments');
});
