import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import Ajv from 'ajv';
import { expect, it } from 'vitest';
import { analyzeRepositoryV2 } from '../../../app/lib/analyzer/v2/pipeline';
import { normalizeArtifactForExport } from '../../../app/lib/export/graph/normalize';
import { buildCsvBundle } from '../../../app/lib/export/graph/csv';
import { buildGraphJson } from '../../../app/lib/export/graph/json';
import { buildCypher } from '../../../app/lib/export/graph/cypher';
import { buildParquetBundle } from '../../../app/lib/export/graph/parquet';
import { generateTextReport } from '../../../app/lib/export/text-report';
import { analysisQuality } from '../../../app/lib/analysis-quality';
import { makeV2Fixture } from './fixtures';

it('preserves bounded extraction provenance in schema-valid JSON, CSV, Parquet, Cypher and TXT', async () => {
  const content = Array.from({ length: 1001 }, (_, index) => `def f${index}():\n    pass`).join('\n');
  const project = await analyzeRepositoryV2({ files: [{ path: 'large.py', content, size: content.length, hash: 'fixture', language: 'Python' }], skipped: [], name: 'bounded', source: 'local://bounded' }, { parserMode: 'tree-sitter' });
  const { document } = await normalizeArtifactForExport(project);
  const expected = document.manifest;
  expect(expected.completeness.status).toBe('COVERAGE_LIMITED');
  expect(expected.coverage.extractionLimits).toContainEqual(expect.objectContaining({ file: 'large.py', category: 'symbols', limit: 1000, omittedCount: 1 }));
  const json = JSON.parse(new TextDecoder().decode((await buildGraphJson(document)).bytes));
  const ajv = new Ajv({ strict: true });
  expect(ajv.compile(JSON.parse(readFileSync('schema/repodna-graph-export-v1.schema.json', 'utf8')))(json)).toBe(true);
  expect(json.manifest).toEqual(expected);
  for (const bundle of [await buildCsvBundle(document), await buildParquetBundle(document)]) {
    const payload = JSON.parse(new TextDecoder().decode(unzipSync(bundle.bytes)['manifest.json']));
    // Bundles additionally carry format-specific integrity/column metadata.
    for (const key of Object.keys(expected)) expect(payload[key]).toEqual(expected[key as keyof typeof expected]);
    expect(payload.files).toHaveLength(5);
  }
  const cypher = new TextDecoder().decode((await buildCypher(document)).bytes);
  const carrier = cypher.match(/^\/\/ Export manifest JSON \(base64 UTF-8\): ([A-Za-z0-9+/=]+)$/m)![1];
  expect(JSON.parse(Buffer.from(carrier, 'base64').toString('utf8'))).toEqual(expected);
  const txt = generateTextReport(project);
  expect(txt).toContain('Completeness: COVERAGE_LIMITED');
  expect(txt).toContain('Extraction limit symbols=1000 @ large.py:');
  expect(txt).toContain('omitted=1');
  expect(txt).not.toContain('All extracted relationships resolved.');
});

it('does not trust optimistic complete flags when canonical relationships or limits contradict them', async () => {
  const project = makeV2Fixture();
  expect(analysisQuality(project).status).toBe('MOSTLY_MAPPED');
  expect(analysisQuality(project).unresolvedCount).toBe(2);
  expect((await normalizeArtifactForExport(project)).document.manifest.completeness.status).toBe('MOSTLY_MAPPED');
  expect(generateTextReport(project)).toContain('Completeness: MOSTLY_MAPPED');
  project.completeness = { status: 'COVERAGE_LIMITED', reasons: ['GRAPH_EDGES_COMPACTED'] };
  expect(analysisQuality(project).status).toBe('COVERAGE_LIMITED');
  expect((await normalizeArtifactForExport(project)).document.manifest.completeness.status).toBe('COVERAGE_LIMITED');
});
