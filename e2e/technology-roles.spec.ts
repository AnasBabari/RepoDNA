import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { expect, test, type Page } from '@playwright/test';
import type { RepoDNAProject } from '../app/lib/types';
import type { RepoDNAProjectV2 } from '../app/lib/analyzer/v2/types';

test.beforeEach(async ({ context, baseURL }) => {
  await context.route('**/*', (route) => baseURL && route.request().url().startsWith(baseURL) ? route.continue() : route.abort());
});
async function downloadArtifact(page: Page) {
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  return JSON.parse(readFileSync((await (await promise).path())!, 'utf8')) as RepoDNAProject | RepoDNAProjectV2;
}
async function uploadZip(page: Page, sources: Record<string, string>) {
  await page.goto('/');
  await expect(page.locator('.preview-warning')).toBeVisible();
  const entries = Object.fromEntries(Object.entries(sources).map(([path, content]) => [`fixture/${path}`, strToU8(content)]));
  await page.locator('input[accept=".zip,application/zip,.json,application/json"]').setInputFiles({ name: 'roles.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(entries)) });
  await expect(page.locator('.workspace')).toBeVisible({ timeout: 60_000 });
}
test('legacy canonical language ordering cannot make a 99.6% Python project claim CSS', async ({ page }) => {
  const project = JSON.parse(readFileSync('public/samples/nanogpt.json', 'utf8')) as RepoDNAProjectV2;
  project.repository.languages = { CSS: 0.1, HTML: 0.3, Python: 99.6 };
  project.repository.fingerprint.languages = ['CSS', 'HTML', 'Python'];
  await page.route('**/samples/nanogpt.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(project) }));
  await page.goto('/?repo=https://github.com/karpathy/nanoGPT');
  const builtWith = page.locator('.plain-summary-grid article').filter({ has: page.getByText('Built with', { exact: true }) });
  await expect(builtWith.locator('strong')).toHaveText('Python');
  await expect(builtWith).toContainText('99.6%');
  expect((await downloadArtifact(page)).repository.languages).toEqual(project.repository.languages);
});
test('actual Python src/app uploads remain unclassified in the visible architecture and JSON', async ({ page }) => {
  await uploadZip(page, { 'src/requests/session.py': 'class Session:\n    pass\n', 'app/main.py': 'def run():\n    pass\n' });
  await expect(page.locator('.plain-summary-grid')).toContainText('Python');
  const artifact = await downloadArtifact(page);
  expect(artifact.architecture.components.some((area) => area.type === 'frontend')).toBe(false);
  expect(artifact.architecture.components.find((area) => area.type === 'other')).toMatchObject({ name: 'Unclassified files', confidence: 0.35 });
  await page.locator('.sidebar button[title="Architecture"]').click();
  await expect(page.locator('.architecture-node .arch-node-title')).toContainText(['Unclassified files']);
  await expect(page.locator('.architecture-node')).not.toContainText(['Frontend']);
});
test('actual React and Next-style uploads keep frontend evidence without absorbing Python files', async ({ page }) => {
  await uploadZip(page, { 'src/App.tsx': 'export function App() { return <main />; }', 'app/page.tsx': 'export default function Page() { return <section />; }', 'app/main.py': 'def run():\n    pass\n' });
  const artifact = await downloadArtifact(page);
  expect(artifact.architecture.components.find((area) => area.type === 'frontend')).toMatchObject({ files: ['app/page.tsx', 'src/App.tsx'], confidence: 0.94, evidence: ['UI component symbol'] });
  expect(artifact.architecture.components.find((area) => area.type === 'other')?.files).toEqual(['app/main.py']);
});
