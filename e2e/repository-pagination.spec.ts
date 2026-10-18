import { expect, test } from '@playwright/test';

test('private picker browses all OAuth pages and discloses bounded search', async ({ page, baseURL }) => {
  await page.route('**/*', (route) => baseURL && route.request().url().startsWith(baseURL) ? route.continue() : route.abort());
  await page.route('**/api/auth/session', (route) => route.fulfill({ json: { user: { id: 'test-user', name: 'Test user' } } }));
  const requests: number[] = [];
  await page.route('**/api/github/repositories?**', (route) => {
    const url = new URL(route.request().url());
    const number = Number(url.searchParams.get('page'));
    requests.push(number);
    const query = url.searchParams.get('query');
    const repositories = query ? [] : Array.from({ length: number === 3 ? 1 : 15 }, (_, index) => ({ id: (number - 1) * 15 + index, fullName: `owner/repo-${(number - 1) * 15 + index}`, isPrivate: true, defaultBranch: 'main' }));
    return route.fulfill({ json: { success: true, repositories, page: number, hasMore: !query && number < 3, searchScope: query ? 'OAuth search covers only the 100 most recently updated accessible repositories. Older repositories may be omitted.' : null } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Test user · Repositories' }).click();
  const dialog = page.locator('.dialog-card');
  await expect(dialog.getByRole('button', { name: 'Analyze Map' })).toHaveCount(15);
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByText('Page 2', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Analyze Map' })).toHaveCount(15);
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByRole('button', { name: 'Analyze Map' })).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: 'Next' })).toBeDisabled();
  await dialog.getByPlaceholder('Search your repositories by name or description...').fill('older-repo');
  await expect(dialog.getByRole('status')).toContainText('100 most recently updated');
  await expect(dialog.getByRole('button', { name: 'Next' })).toBeDisabled();
  expect(requests).toEqual([1, 2, 3, 1]);
});
