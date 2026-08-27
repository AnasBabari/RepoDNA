/**
 * UI driving helpers: deterministic navigation into the workspace, opening the
 * Code Graph tab + export dialog, and capturing generated downloads.
 *
 * All flows avoid live GitHub / Vercel Blob access:
 *  - loadSampleWorkspace   : featured-repo URL whose /samples/*.json is mocked
 *  - importJsonViaLanding  : real local JSON-import seam (private/local parity)
 *  - loadDurableWorkspace  : fully mocked durable deep-analysis workflow
 */
import { expect, type Download, type Page } from '@playwright/test';

import { buildCanonicalProjectV2, buildLargeCanonicalProject } from '../fixtures/canonical-project';
import {
  DURABLE_REPO_URL,
  SAMPLE_REPO_URL,
  type GraphExportHarness,
} from './harness';

export type ExportFormatLabel = 'Graph JSON' | 'CSV tables' | 'Neo4j Cypher' | 'Parquet';

const NAV_TIMEOUT = 60_000;

function artifactJsonBuffer(project: ReturnType<typeof buildCanonicalProjectV2> | ReturnType<typeof buildLargeCanonicalProject>): Buffer {
  return Buffer.from(JSON.stringify(project), 'utf-8');
}

async function waitForWorkspace(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Code Graph' })).toBeVisible({ timeout: NAV_TIMEOUT });
}

/** Entry via the featured-repo URL; the sample fetch is intercepted in harness. */
export async function loadSampleWorkspace(page: Page): Promise<void> {
  await page.goto(`/?repo=${encodeURIComponent(SAMPLE_REPO_URL)}`);
  await waitForWorkspace(page);
}

/**
 * Entry through the real private/local seam: the landing "Upload Repository
 * .zip or .json" hidden input fed a RepoDNA v2 JSON file.
 */
export async function importJsonViaLanding(
  page: Page,
  options: { large?: boolean; enabledRetention?: boolean } = {}
): Promise<void> {
  await page.goto('/');
  const retentionToggle = page.locator('.browser-retention-toggle input[type="checkbox"]');
  if (options.enabledRetention) {
    await retentionToggle.check();
  } else if ((await retentionToggle.count()) > 0) {
    await expect(retentionToggle).toBeChecked({ checked: false }).catch(() => undefined);
  }
  // The landing page is SSR-rendered, so wait for the client event handlers to
  // hydrate before setting a hidden file input.
  await page.waitForTimeout(2_000);

  const file = {
    name: 'export-lab.json',
    mimeType: 'application/json',
    buffer: artifactJsonBuffer(options.large ? buildLargeCanonicalProject({ nodeCount: 4000, edgesPerNode: 2 }) : buildCanonicalProjectV2()),
  };
  const input = page.locator('input[accept=".zip,application/zip,.json,application/json"]');
  await expect(input).toHaveCount(1);
  await input.setInputFiles(file);
  await waitForWorkspace(page);
}

/**
 * Entry through the durable public workflow; every endpoint is canned so no
 * GitHub/Blob traffic occurs. Produces origin 'public-durable' with identity,
 * which makes the dialog consult /api/v2/exports first.
 */
export async function loadDurableWorkspace(page: Page): Promise<void> {
  await page.goto(`/?repo=${encodeURIComponent(DURABLE_REPO_URL)}`);
  await waitForWorkspace(page);
}

export async function openCodeGraphTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Code Graph' }).click();
  await expect(page.locator('.react-flow__node[data-id]').first()).toBeVisible({ timeout: NAV_TIMEOUT });
}

export function exportTrigger(page: Page) {
  // Exact-match avoids colliding with Architecture view's "Copy Mermaid" pill.
  return page.getByRole('button', { name: 'Export', exact: true });
}

export async function openExportDialog(page: Page) {
  await openCodeGraphTab(page);
  await exportTrigger(page).click();
  const dialog = page.getByRole('dialog', { name: 'Export graph' });
  await expect(dialog).toBeVisible();
  return dialog;
}

function formatButton(dialog: ReturnType<Page['getByRole']>, label: ExportFormatLabel) {
  return dialog.getByRole('button', { name: `Export ${label}` });
}

export interface GeneratedDownload {
  filename: string;
  bytes: Buffer;
}

/**
 * Clicks an export row button and captures the triggered download.
 * The app always downloads to disk through an anchor click.
 */
export async function generateExport(page: Page, label: ExportFormatLabel): Promise<GeneratedDownload> {
  const dialog = page.getByRole('dialog', { name: 'Export graph' });
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  await formatButton(dialog, label).click();
  const download: Download = await downloadPromise;
  const filename = download.suggestedFilename();
  const path = await download.path();
  if (!path) throw new Error(`Download ${filename} did not produce a file path`);
  const { readFile } = await import('node:fs/promises');
  const bytes = await readFile(path);
  return { filename, bytes };
}

/**
 * Same as generateExport but resolves only once the success badge for that
 * format row renders ("generated now"), proving post-download state settled.
 */
export async function generateExportToSuccess(page: Page, label: ExportFormatLabel): Promise<GeneratedDownload> {
  const result = await generateExport(page, label);
  const dialog = page.getByRole('dialog', { name: 'Export graph' });
  const row = dialog.locator(`section[aria-label="${label}"]`);
  await expect(row.getByText('generated now')).toBeVisible({ timeout: 30_000 });
  return result;
}

export function serverExportCalls(harness: GraphExportHarness): string[] {
  return harness.requestLog.urls.filter((url) => url.includes('/api/v2/exports'));
}

export const EXPORTS_ENDPOINT_SUBSTRING = '/api/v2/exports';
