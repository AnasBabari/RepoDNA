import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getDownloadUrl } from '@vercel/blob';
import { installGraphExportHarness } from './helpers/harness';
import { generateExport, loadDurableWorkspace, loadSampleWorkspace, openExportDialog, type ExportFormatLabel } from './helpers/app-driver';

test('cached exports retain filenames and bytes across real cross-origin downloads', async ({ page }) => {
  const files = new Map<string, { filename: string; bytes: Buffer; sha256: string; label: ExportFormatLabel }>();
  const requested: string[] = [];
  // No CORS or same-origin route fulfillment: Chromium navigates to an actual
  // second HTTP origin, whose attachment name comes from the Blob pathname.
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const file = files.get(url.pathname);
    if (!file || url.searchParams.get('download') !== '1') { res.writeHead(404).end(); return; }
    requested.push(url.pathname);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${url.pathname.split('/').at(-1)}"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(file.bytes);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${port}`;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await installGraphExportHarness(page);
    await page.route(`${origin}/**`, route => route.continue());
    await loadSampleWorkspace(page);
    await openExportDialog(page);
    const labels: ExportFormatLabel[] = ['Graph JSON', 'CSV tables', 'Neo4j Cypher',
      ...(process.env.NEXT_PUBLIC_REPODNA_PARQUET_EXPORT === 'true' ? ['Parquet' as const] : [])];
    // Generate the reference bytes and names through the real client worker.
    for (const label of labels) {
      const file = await generateExport(page, label);
      files.set(`/cache/${file.filename}`, { ...file, label,
        sha256: createHash('sha256').update(file.bytes).digest('hex') });
    }
    await loadDurableWorkspace(page);
    await openExportDialog(page);
    for (const [pathname, file] of files) {
      let calls = 0;
      await page.route('**/api/v2/exports', route => route.fulfill({ json: {
        filename: file.filename, mediaType: 'application/octet-stream', byteSize: file.bytes.length, sha256: file.sha256,
        cache: { layer: 'vercel-blob', hit: calls++ > 0, expiresAt: new Date(Date.now() + 60_000).toISOString() },
        download: { url: getDownloadUrl(`${origin}${pathname}`), expiresAt: new Date(Date.now() + 300_000).toISOString() },
      } }));
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await generateExport(page, file.label);
        expect(result.filename).toBe(file.filename);
        expect(createHash('sha256').update(result.bytes).digest('hex')).toBe(file.sha256);
      }
      expect(calls).toBe(2);
      expect(requested.filter(path => path === pathname)).toHaveLength(2);
      await page.unroute('**/api/v2/exports');
    }
    expect(errors).toEqual([]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
