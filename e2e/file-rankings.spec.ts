import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { RepoDNAProjectV2 } from '../app/lib/analyzer/v2/types';
import { assertArchitectureConsistency } from '../app/lib/analysis-lifecycle';
import { projectV2ForWorkspace } from '../app/lib/schema/v2-viewer-projection';

const sample = JSON.parse(readFileSync('public/samples/nanogpt.json', 'utf8')) as RepoDNAProjectV2;

test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) => baseURL && route.request().url().startsWith(baseURL) ? route.continue() : route.abort());
});

test('technical file rankings group symbols but preserve canonical evidence and same-basename files', async ({ page }) => {
  const project = structuredClone(sample);
  const symbols = project.nodes.filter((node) => node.path === 'train.py' && node.kind === 'function').slice(0, 2);
  expect(symbols).toHaveLength(2);
  const sourceFile = project.nodes.find((node) => node.path === 'train.py' && node.kind === 'file')!;
  project.nodes.push({ ...sourceFile, id: 'fixture-tools-file', path: 'tools/train.py', name: 'train.py', qualifiedName: 'tools/train.py' });
  project.nodes.push({ ...symbols[0], id: 'fixture-tools-train', path: 'tools/train.py', qualifiedName: 'tools/train.py::train' });
  project.centrality.mostConnected = [
    { nodeId: symbols[0].id, score: 17, inDegree: 10, outDegree: 7 },
    { nodeId: symbols[1].id, score: 11, inDegree: 6, outDegree: 5 },
    { nodeId: 'fixture-tools-train', score: 5, inDegree: 3, outDegree: 2 },
  ];
  assertArchitectureConsistency(projectV2ForWorkspace(project));
  const duplicateWarnings: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (/same key|unique.*key/i.test(message.text())) duplicateWarnings.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/samples/nanogpt.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(project) }));
  await page.goto('/?repo=https://github.com/karpathy/nanoGPT');
  await expect(page.locator('.workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Technical', exact: false }).click();
  const rows = page.locator('.important-grid article');
  await expect(rows).toHaveCount(2);
  await expect(rows.locator('strong')).toHaveText(['train.py', 'tools/train.py']);
  await expect(rows.locator('i')).toHaveText(['28 pts', '5 pts']);
  for (const symbol of symbols) await expect(rows.first()).toContainText(symbol.name);
  await expect(page.locator('.important-panel')).toContainText('not unique inter-file dependencies');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const artifact = JSON.parse(readFileSync((await (await downloadPromise).path())!, 'utf8')) as RepoDNAProjectV2;
  expect(artifact.nodes).toEqual(project.nodes);
  expect(artifact.centrality).toEqual(project.centrality);
  expect(duplicateWarnings).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('the bundled nanoGPT technical overview has unique file rows without duplicate-key warnings', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (/same key|unique.*key/i.test(message.text())) warnings.push(message.text());
  });
  await page.goto('/?repo=https://github.com/karpathy/nanoGPT');
  await expect(page.locator('.workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Technical', exact: false }).click();
  const names = await page.locator('.important-grid article strong').allTextContents();
  expect(names.length).toBeGreaterThan(0);
  expect(new Set(names).size).toBe(names.length);
  expect(warnings).toEqual([]);
});
