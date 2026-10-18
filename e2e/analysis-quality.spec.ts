import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { RepoDNAProjectV2 } from '../app/lib/analyzer/v2/types';

const sample = JSON.parse(readFileSync('public/samples/nanogpt.json', 'utf8')) as RepoDNAProjectV2;
test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) => baseURL && route.request().url().startsWith(baseURL) ? route.continue() : route.abort());
});

test('nanoGPT never claims full mapping beside its 444 unresolved relationships', async ({ page }) => {
  await page.goto('/?sample=https://github.com/karpathy/nanoGPT');
  const summary = page.getByRole('region', { name: 'Plain-language summary' });
  await expect(summary).toContainText('Mostly mapped');
  await expect(summary).toContainText('444 relationships could not be proven statically.');
  await expect(summary).not.toContainText('No unresolved relationships');
  await expect(page.getByRole('region', { name: 'Scan coverage', exact: true })).toContainText('100% source parsed (legacy denominator) · Mostly mapped');
  await page.getByRole('button', { name: 'Technical', exact: false }).click();
  await expect(page.getByRole('region', { name: 'Scan coverage details' })).toContainText('Mostly mapped');
});

for (const category of ['compaction', 'extraction'] as const) {
  test(`${category} has matching limited status in both overview audiences and TXT`, async ({ page }) => {
    const project = structuredClone(sample);
    const code = category === 'compaction' ? 'GRAPH_EDGES_COMPACTED' : 'SOURCE_EXTRACTION_LIMIT_REACHED';
    project.coverage.truncationReasons = [code];
    project.security.truncated = [code];
    project.completeness = { status: 'FULLY_MAPPED', reasons: [] }; // deliberately optimistic legacy metadata
    project.diagnostics.push({ code, severity: 'warning', file: 'train.py', message: 'train.py:1001: symbols extraction limit 1000; omitted 1 symbols facts. Syntax validity is reported separately.' });
    if (category === 'extraction') {
      project.inventory.partiallyParsedFileCount = 1;
      project.inventory.extractionLimits = [{ file: 'train.py', category: 'symbols', limit: 1000, omittedCount: 1, countIsLowerBound: false, range: { startLine: 1001, endLine: 1002, startColumn: 0, endColumn: 4 } }];
    }
    await page.route('**/samples/nanogpt.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(project) }));
    await page.goto('/?sample=https://github.com/karpathy/nanoGPT');
    await expect(page.getByRole('region', { name: 'Plain-language summary' })).toContainText('Coverage limited');
    if (category === 'extraction') {
      const disclosure = page.getByRole('region', { name: 'Extraction limits' });
      await disclosure.locator('summary').click();
      await expect(disclosure).toContainText('symbols extraction limit 1000; omitted 1');
      await expect(disclosure).toContainText('not necessarily syntax errors');
    }
    await page.getByRole('button', { name: 'Technical', exact: false }).click();
    await expect(page.getByRole('region', { name: 'Scan coverage details' })).toContainText('Coverage limited');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'TXT', exact: true }).click();
    const download = await downloadPromise;
    const txt = readFileSync((await download.path())!, 'utf8');
    expect(txt).toContain('Completeness: COVERAGE_LIMITED');
    expect(txt).not.toContain('All extracted relationships resolved.');
  });
}
