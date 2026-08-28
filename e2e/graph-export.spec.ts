import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { unzipSync } from 'fflate';

import {
  generateExport,
  generateExportToSuccess,
  loadDurableWorkspace,
  loadSampleWorkspace,
  openCodeGraphTab,
  openExportDialog,
  serverExportCalls,
  type ExportFormatLabel,
} from './helpers/app-driver';
import {
  installGraphExportHarness,
  type GraphExportHarness,
} from './helpers/harness';

const GRAPH_JSON: ExportFormatLabel = 'Graph JSON';
const CSV: ExportFormatLabel = 'CSV tables';
const CYPHER: ExportFormatLabel = 'Neo4j Cypher';
const PARQUET: ExportFormatLabel = 'Parquet';

const EXPECTED_CSV_FILES = [
  'manifest.json',
  'nodes.csv',
  'relationships.csv',
  'groups.csv',
  'group_memberships.csv',
  'unresolved.csv',
].sort();

let harness: GraphExportHarness;

function sha256(buf: Uint8Array | Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function csvRowCount(text: string): number {
  const lines = text.replace(/\r\n$/, '').split('\r\n');
  return Math.max(0, lines.length - 1);
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

async function openSampleExport(page: Page): Promise<void> {
  await loadSampleWorkspace(page);
  await openExportDialog(page);
}

test.beforeEach(async ({ page }) => {
  harness = await installGraphExportHarness(page);
});

test.describe('graph export browser contract', () => {
  test('opens from Code Graph, traps focus, and restores focus when closed', async ({ page }) => {
    await loadSampleWorkspace(page);
    await openCodeGraphTab(page);
    const exportButton = page.getByRole('button', { name: 'Export', exact: true });
    await expect(exportButton).toBeVisible();
    await exportButton.focus();
    await exportButton.click();

    const dialog = page.getByRole('dialog', { name: 'Export graph' });
    await expect(dialog).toBeVisible();
    const closeButton = dialog.getByRole('button', { name: 'Close export dialog' });
    await expect(closeButton).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Export TXT', exact: true })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(exportButton).toBeFocused();
  });

  test('exports schema-valid deterministic Graph JSON', async ({ page }) => {
    await openSampleExport(page);

    const first = await generateExportToSuccess(page, GRAPH_JSON);
    const second = await generateExport(page, GRAPH_JSON);
    expect(first.filename).toMatch(/-repodna-graph\.json$/);
    expect(second.filename).toBe(first.filename);
    expect(sha256(first.bytes)).toBe(sha256(second.bytes));

    const document = JSON.parse(decode(first.bytes)) as {
      manifest: { counts: Record<string, number> };
      nodes: unknown[];
      relationships: unknown[];
      groups: unknown[];
      groupMemberships: unknown[];
      unresolved: unknown[];
    };
    const schemaPath = join(process.cwd(), 'schema', 'repodna-graph-export-v1.schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as object;
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const valid = ajv.validate(schema, document);
    expect(valid, JSON.stringify(ajv.errors)).toBe(true);
    expect(document.manifest.counts.nodes).toBe(document.nodes.length);
    expect(document.manifest.counts.relationships).toBe(document.relationships.length);
    expect(document.manifest.counts.groups).toBe(document.groups.length);
    expect(document.manifest.counts.groupMemberships).toBe(document.groupMemberships.length);
    expect(document.manifest.counts.unresolved).toBe(document.unresolved.length);
  });

  test('exports CSV tables with JSON-parity counts and formula protection', async ({ page }) => {
    await openSampleExport(page);

    const jsonDownload = await generateExport(page, GRAPH_JSON);
    const csvDownload = await generateExportToSuccess(page, CSV);
    expect(csvDownload.filename).toMatch(/-repodna-csv\.zip$/);

    const graph = JSON.parse(decode(jsonDownload.bytes)) as {
      nodes: unknown[];
      relationships: unknown[];
      groups: unknown[];
      groupMemberships: unknown[];
      unresolved: unknown[];
    };
    const files = unzipSync(new Uint8Array(csvDownload.bytes));
    expect(Object.keys(files).sort()).toEqual(EXPECTED_CSV_FILES);
    expect(csvRowCount(decode(files['nodes.csv']))).toBe(graph.nodes.length);
    expect(csvRowCount(decode(files['relationships.csv']))).toBe(graph.relationships.length);
    expect(csvRowCount(decode(files['groups.csv']))).toBe(graph.groups.length);
    expect(csvRowCount(decode(files['group_memberships.csv']))).toBe(graph.groupMemberships.length);
    expect(csvRowCount(decode(files['unresolved.csv']))).toBe(graph.unresolved.length);
    expect(decode(files['nodes.csv'])).toContain("'=IMPORTXML");
    expect(decode(files['nodes.csv'])).not.toContain('"=IMPORTXML"');
  });

  test('exports deterministic Cypher without an AI request', async ({ page }) => {
    await openSampleExport(page);

    const download = await generateExportToSuccess(page, CYPHER);
    const text = decode(download.bytes);
    expect(download.filename).toMatch(/-repodna-cypher\.txt$/);
    expect(text).toContain('CREATE CONSTRAINT repo_dna_entity_id IF NOT EXISTS');
    expect(text).toContain('UNWIND');
    expect(text).toContain('MERGE');
    expect(text).toContain('RepoDNAUnresolved');
    expect(text).not.toContain('apoc.');
    expect(harness.requestLog.urls.filter((url) => /openai|anthropic|gemini|api\.openrouter/i.test(url))).toHaveLength(0);
  });

  test('falls back to the browser when the public server export cache is unavailable', async ({ page }) => {
    await loadDurableWorkspace(page);
    await openExportDialog(page);

    await generateExportToSuccess(page, GRAPH_JSON);
    await expect(page.getByRole('status').filter({ hasText: 'generated safely in your browser' })).toBeVisible();
    expect(serverExportCalls(harness)).toHaveLength(1);
    expect(harness.requestLog.exportPostBodies[0]).toMatchObject({
      format: 'graph-json',
      exportSchemaVersion: '1.0.0',
      owner: 'e2e-fixtures',
      repo: 'export-lab',
    });
  });

  test('exports the full canonical graph even when the rendered graph is filtered', async ({ page }) => {
    await loadSampleWorkspace(page);
    await openCodeGraphTab(page);
    await page.getByRole('button', { name: 'Unresolved only' }).click();
    await openExportDialog(page);

    const download = await generateExportToSuccess(page, GRAPH_JSON);
    const document = JSON.parse(decode(download.bytes)) as {
      manifest: { counts: { nodes: number; relationships: number } };
      nodes: unknown[];
      relationships: unknown[];
    };
    expect(document.nodes.length).toBe(document.manifest.counts.nodes);
    expect(document.relationships.length).toBe(document.manifest.counts.relationships);
    expect(document.nodes.length).toBeGreaterThan(0);
  });

  test('does not expose Parquet while the production feature gate is disabled', async ({ page }) => {
    test.skip(process.env.NEXT_PUBLIC_REPODNA_PARQUET_EXPORT === 'true', 'Parquet is enabled for this run');
    await openSampleExport(page);
    await expect(page.getByRole('button', { name: /Export Parquet/ })).toHaveCount(0);
  });

  test('exports readable Parquet tables when the feature gate is enabled', async ({ page }) => {
    test.skip(process.env.NEXT_PUBLIC_REPODNA_PARQUET_EXPORT !== 'true', 'Run with NEXT_PUBLIC_REPODNA_PARQUET_EXPORT=true');
    await openSampleExport(page);

    const download = await generateExportToSuccess(page, PARQUET);
    expect(download.filename).toMatch(/-repodna-parquet\.zip$/);
    const files = unzipSync(new Uint8Array(download.bytes));
    expect(Object.keys(files).sort()).toEqual([
      'manifest.json',
      'nodes.parquet',
      'relationships.parquet',
      'groups.parquet',
      'group_memberships.parquet',
      'unresolved.parquet',
    ].sort());
    for (const name of Object.keys(files).filter((file) => file.endsWith('.parquet'))) {
      expect(decode(files[name].slice(0, 4))).toBe('PAR1');
      expect(decode(files[name].slice(-4))).toBe('PAR1');
    }
    const manifest = JSON.parse(decode(files['manifest.json'])) as {
      format: string;
      parquet: { tables: Array<{ name: string; filename: string; columns: unknown[] }> };
      files: Array<{ name: string; byteSize: number; sha256: string }>;
    };
    expect(manifest.format).toBe('parquet');
    expect(manifest.parquet.tables).toHaveLength(5);
    expect(manifest.files).toHaveLength(5);
    expect(manifest.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256) && file.byteSize > 0)).toBe(true);
  });

  test('exports the human-readable Architecture TXT report', async ({ page }) => {
    await openSampleExport(page);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export TXT', exact: true }).click();
    const download = await downloadPromise;
    const filename = download.suggestedFilename();
    const path = await download.path();
    if (!path) throw new Error(`Download ${filename} did not produce a file path`);
    const report = readFileSync(path, 'utf8');

    expect(filename).toMatch(/-repodna-architecture\.txt$/);
    expect(report).toContain('Repository identity');
    expect(report).toContain('Scan coverage and limitations');
    expect(report).toContain('Unresolved and ambiguous relationships');
  });
});
