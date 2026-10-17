import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { installRevisionHarness, REVISION_REPO, REVISION_SHA } from './helpers/revision-harness';
import { generateExportToSuccess, openExportDialog } from './helpers/app-driver';
import type { RepoDNAProjectV2 } from '../app/lib/analyzer/v2/types';

for (const [path, ref] of [['/tree/test-v1', 'test-v1'], ['/blob/feature%2Freview/main.py', 'feature/review']]) {
  test(`actual browser scan preserves ${path} through worker, workspace and exports`, async ({ page, baseURL }) => {
    const calls = await installRevisionHarness(page, baseURL, [ref]);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(page.locator('.preview-warning')).toBeVisible();
    await page.getByRole('textbox', { name: 'GitHub repository URL', exact: true }).fill(REVISION_REPO + path);
    await page.getByRole('button', { name: 'Analyze repository', exact: true }).click();
    await expect(page.locator('.workspace')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.snapshot-provenance')).toContainText(REVISION_SHA);
    await expect(page.locator('.snapshot-provenance')).toContainText('does not narrow the scan');
    expect(calls.submitted.map((call) => call.url)).toEqual([REVISION_REPO + path, REVISION_REPO + path]);
    expect(calls.refs).toEqual([ref]);
    expect(calls.archives).toEqual([`https://codeload.github.com/karpathy/nanoGPT/zip/${REVISION_SHA}`]);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'JSON', exact: true }).click();
    const project = JSON.parse(readFileSync((await (await download).path())!, 'utf8')) as RepoDNAProjectV2;
    expect(project.repository).toMatchObject({ commitSha: REVISION_SHA, analyzedRef: REVISION_SHA, source: `${REVISION_REPO}/tree/${REVISION_SHA}` });
    expect(project.nodes.some((node) => node.name === 'selected_release')).toBe(true);
    expect(project.nodes.some((node) => node.path === 'train.py')).toBe(false); // not the bundled nanoGPT snapshot
    await openExportDialog(page);
    const exported = JSON.parse((await generateExportToSuccess(page, 'Graph JSON')).bytes.toString('utf8'));
    expect(exported.manifest.repository).toMatchObject({ commitSha: REVISION_SHA, analyzedRef: REVISION_SHA });
    expect(errors).toEqual([]);
  });
}

test('actual browser ambiguity is actionable and never substitutes HEAD or an archive', async ({ page, baseURL }) => {
  const calls = await installRevisionHarness(page, baseURL, ['feature', 'feature/review']);
  await page.goto('/');
  await expect(page.locator('.preview-warning')).toBeVisible();
  await page.getByRole('textbox', { name: 'GitHub repository URL', exact: true }).fill(`${REVISION_REPO}/tree/feature/review`);
  await page.getByRole('button', { name: 'Analyze repository', exact: true }).click();
  await expect(page.getByText('This URL matches multiple branch/tag boundaries.', { exact: false })).toBeVisible();
  expect(calls.refs.toSorted()).toEqual(['feature', 'feature/review']);
  expect(calls.archives).toEqual([]);
  await expect(page.locator('.workspace')).toHaveCount(0);
});

test('an explicit server ref error stops without silently trying another analysis path', async ({ page, baseURL }) => {
  const calls = await installRevisionHarness(page, baseURL, []);
  await page.route('**/api/v2/analyses', (route) => route.fulfill({ status: 400, json: { error: { code: 'GITHUB_REF_AMBIGUOUS', message: 'Choose the explicit ref.', fallbackAvailable: false } } }));
  await page.goto('/');
  await expect(page.locator('.preview-warning')).toBeVisible();
  await page.getByRole('textbox', { name: 'GitHub repository URL', exact: true }).fill(`${REVISION_REPO}/tree/feature/review`);
  await page.getByRole('button', { name: 'Analyze repository', exact: true }).click();
  await expect(page.getByText('This URL matches multiple branch/tag boundaries.', { exact: false })).toBeVisible();
  expect(calls.submitted).toEqual([]);
  expect(calls.refs).toEqual([]);
  expect(calls.archives).toEqual([]);
});
