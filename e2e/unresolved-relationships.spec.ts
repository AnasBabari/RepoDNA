import { expect, test, type Page, type BrowserContext } from '@playwright/test';
import { makeV2Fixture, mkEdge } from '../tests/unit/export/fixtures';
import type { RepoDNAProjectV2 } from '../app/lib/analyzer/v2/types';

async function load(page: Page, context: BrowserContext, baseURL: string | undefined, project: RepoDNAProjectV2) {
  await context.route('**/*', (route) => baseURL && route.request().url().startsWith(baseURL) ? route.continue() : route.abort());
  await page.route('**/samples/nanogpt.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(project) }));
  await page.goto('/?repo=https://github.com/karpathy/nanoGPT');
  await page.getByRole('button', { name: 'Code Graph' }).click();
  await page.getByRole('button', { name: 'Unresolved only', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unresolved only', exact: true })).toHaveAttribute('aria-pressed', 'true');
}

test('all-null gaps remain inspectable, paginated, searchable and absent from drawn edge count', async ({ page, context, baseURL }) => {
  const project = makeV2Fixture();
  project.edges = Array.from({ length: 55 }, (_, n) => mkEdge(`gap-${n.toString().padStart(2, '0')}`, 'n-func-f', null, 'CALLS', 'unresolved', { unresolvedExpression: `unknown${n}()`, alternativeCandidates: n === 54 ? ['n-class-c', 'n-file-a'] : [] }));
  project.unresolved = [{ edgeId: 'gap-54', reason: 'dynamic runtime lookup', candidates: ['n-class-c'] }, { edgeId: 'orphan-record', reason: 'edge not retained', candidates: [] }];
  await load(page, context, baseURL, project);
  await expect(page.locator('.code-graph-status')).toContainText('0 edges shown · 56 retained unresolved records not drawn');
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  const ids = await page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')).sort());
  expect(ids).toEqual(['n-class-c', 'n-file-a', 'n-func-f']);
  const records = page.getByRole('region', { name: 'Unresolved relationship records', exact: true });
  await expect(records.locator('li')).toHaveCount(25);
  await records.getByRole('button', { name: 'Next records' }).click();
  await records.getByRole('button', { name: 'Next records' }).click();
  await expect(records.locator('li')).toHaveCount(6);
  await records.getByRole('textbox', { name: 'Search unresolved relationships' }).fill('unknown54');
  await records.locator('li summary').click();
  await expect(records).toContainText('dynamic runtime lookup');
  await expect(records).toContainText('src/a.py:1:0');
  await expect(records).toContainText('Alternative candidates: n-class-c, n-file-a');
  await records.getByRole('button', { name: 'Inspect evidence', exact: true }).click();
  const drawer = page.getByRole('complementary', { name: 'Why are these connected' });
  await expect(drawer).toContainText('Resolution reason: dynamic runtime lookup');
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.react-flow__node[data-id="n-func-f"] .code-node-glyph').click();
  await page.getByRole('button', { name: 'Show 55 unresolved relationships' }).click();
  await expect(records.getByRole('textbox')).toBeFocused();
  await expect(records.getByRole('status')).toContainText('55 matching records');
  await records.getByRole('button', { name: 'Show all sources' }).click();
  await records.getByRole('textbox').fill('orphan-record');
  await records.locator('li summary').click();
  await expect(records).toContainText('Evidence: not available in retained artifact');
  await records.getByRole('textbox').fill('no-such-expression');
  await expect(records).toContainText('No matching retained records.');
});

test('displayed drawn-edge count matches the canvas with mixed null, self and drawable gaps', async ({ page, context, baseURL }) => {
  const project = makeV2Fixture();
  project.edges = project.edges.filter((edge) => edge.target === null);
  project.edges.push(mkEdge('self-gap', 'n-func-f', 'n-func-f', 'CALLS', 'unresolved'));
  project.edges.push(mkEdge('visible-gap', 'n-func-f', 'n-class-c', 'CALLS', 'ambiguous'));
  await load(page, context, baseURL, project);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await expect(page.locator('.code-graph-status')).toContainText('1 edge shown · 3 retained unresolved records not drawn');
  await page.getByRole('combobox', { name: 'Relationship filter' }).selectOption('routes');
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await expect(page.locator('.code-graph-status')).toContainText('0 edges shown · 4 retained unresolved records not drawn');
});
