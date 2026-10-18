import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { unzipSync } from 'fflate';
import { expect, it } from 'vitest';
import { analyzeRepositoryV2 } from '../../../app/lib/analyzer/v2/pipeline';
import { normalizeArtifactForExport } from '../../../app/lib/export/graph/normalize';
import { buildGraphJson } from '../../../app/lib/export/graph/json';
import { buildCsvBundle } from '../../../app/lib/export/graph/csv';
import { buildParquetBundle } from '../../../app/lib/export/graph/parquet';
import { buildCypher } from '../../../app/lib/export/graph/cypher';
import { generateTextReport } from '../../../app/lib/export/text-report';
import { makeV2Fixture } from './fixtures';
import { analyzeRepositoryFiles } from '../../../app/lib/analyzer';

it('retains the same source outcomes and manifest declarations in every portable format', async () => {
  const file = (path: string, content: string) => ({ path, content, size: content.length, hash: path });
  const project = await analyzeRepositoryV2({ files: [file('api.py', 'import requests\n'), file('Makefile', 'all:\n\techo not run'), file('pyproject.toml', '[project]\nname="api"\ndependencies=["requests @ https://user:NOT_EXPORTED@example.test/a.whl"]\n[dependency-groups]\ndev=["pytest"]')], skipped: [], name: 'api', source: 'local://api' });
  const { document } = await normalizeArtifactForExport(project);
  const expected = document.manifest;
  const json = JSON.parse(new TextDecoder().decode((await buildGraphJson(document)).bytes));
  expect(new Ajv({ strict: true }).compile(JSON.parse(readFileSync('schema/repodna-graph-export-v1.schema.json', 'utf8')))(json)).toBe(true);
  expect(json.manifest).toEqual(expected);
  expect(expected.sourceOutcomes).toMatchObject({ supported: 1, complete: 1, partial: 0 });
  expect(expected.sourceInventory).toMatchObject({ evidenceFileCount: 2, unsupportedSourceFileCount: 0 });
  expect(expected.manifestInventory?.declarations).toContainEqual(expect.objectContaining({ name: 'requests', root: '.', scope: 'runtime', file: 'pyproject.toml' }));
  for (const bundle of [await buildCsvBundle(document), await buildParquetBundle(document)]) {
    const manifest = JSON.parse(new TextDecoder().decode(unzipSync(bundle.bytes)['manifest.json']));
    for (const key of ['manifestInventory', 'sourceInventory', 'sourceOutcomes'] as const) expect(manifest[key]).toEqual(expected[key]);
  }
  const cypher = new TextDecoder().decode((await buildCypher(document)).bytes);
  const encoded = cypher.match(/^\/\/ Export manifest JSON \(base64 UTF-8\): ([A-Za-z0-9+/=]+)$/m)![1];
  expect(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))).toEqual(expected);
  const txt = generateTextReport(project);
  expect(txt).toContain('Declared dependencies:     2');
  expect(txt).toContain('[runtime; project.dependencies] — pyproject.toml');
  expect(txt).toContain('1 complete + 0 partial + 0 failed + 0 skipped + 0 unprocessed = 1');
  expect(JSON.stringify(expected)).not.toContain('NOT_EXPORTED');
  expect(txt).not.toContain('NOT_EXPORTED');
});
it('does not print legacy language/import proxies as known manifest or unsupported-source counts', () => {
  const project = makeV2Fixture();
  project.inventory.packageCount = 42;
  project.inventory.declaredDependencyCount = 999;
  const txt = generateTextReport(project);
  expect(txt).toContain('Packages/workspaces:       not recorded');
  expect(txt).toContain('Declared dependencies:     not recorded');
  expect(txt).toContain('Unsupported source files: not recorded (legacy classification)');
  expect(txt).toContain('legacy denominator');
});
it('keeps whole-scan partial counts when the affected file record was compacted out', () => {
  const project = makeV2Fixture();
  project.inventory.sourceOutcomes = { supported: 2, complete: 1, partial: 1, failed: 0, skipped: 0, unprocessed: 0 };
  const txt = generateTextReport(project);
  expect(txt).toContain('Whole-scan supported source: complete=1, partial=1');
  expect(txt).not.toContain('No partial or failed parses');
});
it('prints manifest-backed totals for the local v1 upload report as well as canonical reports', async () => {
  const content = JSON.stringify({ name: 'local', dependencies: { react: '*' } });
  const project = await analyzeRepositoryFiles({ files: [{ path: 'package.json', content, hash: 'fixture', size: content.length }], skipped: [], name: 'local' });
  const txt = generateTextReport(project);
  expect(txt).toContain('Packages/workspaces:       1');
  expect(txt).toContain('Declared dependencies:     1');
});
