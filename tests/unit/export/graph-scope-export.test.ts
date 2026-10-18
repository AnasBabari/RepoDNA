import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import Ajv from 'ajv';
import { expect, it } from 'vitest';
import { makeV2Fixture } from './fixtures';
import { recordedGraphScope, graphCounts, resolveGraphScope } from '../../../app/lib/graph-scope';
import { normalizeArtifactForExport } from '../../../app/lib/export/graph/normalize';
import { buildGraphJson } from '../../../app/lib/export/graph/json';
import { buildCsvBundle } from '../../../app/lib/export/graph/csv';
import { buildParquetBundle } from '../../../app/lib/export/graph/parquet';
import { buildCypher } from '../../../app/lib/export/graph/cypher';
import { generateTextReport } from '../../../app/lib/export/text-report';

for (const legacy of [false, true]) it(`preserves ${legacy ? 'unknown legacy' : 'recorded'} scope in every export`, async () => {
  const project = makeV2Fixture();
  project.coverage.truncationReasons = ['GRAPH_EDGES_COMPACTED'];
  project.graphScope = recordedGraphScope({ nodes: 80000, relationships: 260000, unresolvedRelationships: 500, ambiguousRelationships: 20 }, graphCounts(project));
  if (legacy) delete project.graphScope;
  const scope = resolveGraphScope(project);
  const { document } = await normalizeArtifactForExport(project);
  expect(document.manifest.graphScope).toEqual(scope);
  expect(document.manifest.completeness.status).toBe('COVERAGE_LIMITED');
  const json = JSON.parse(new TextDecoder().decode((await buildGraphJson(document)).bytes));
  expect(json.manifest.graphScope).toEqual(scope);
  expect(new Ajv({ strict: true }).compile(JSON.parse(readFileSync('schema/repodna-graph-export-v1.schema.json', 'utf8')))(json)).toBe(true);
  for (const bundle of [await buildCsvBundle(document), await buildParquetBundle(document)]) {
    const manifest = JSON.parse(new TextDecoder().decode(unzipSync(bundle.bytes)['manifest.json']));
    expect(manifest.graphScope).toEqual(scope);
    expect(manifest.counts).toEqual(document.manifest.counts); // exported tables, not invented full graph
  }
  const cypher = new TextDecoder().decode((await buildCypher(document)).bytes);
  const encoded = cypher.match(/^\/\/ Export manifest JSON \(base64 UTF-8\): ([A-Za-z0-9+/=]+)$/m)![1];
  expect(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')).graphScope).toEqual(scope);
  const txt = generateTextReport(project);
  expect(txt).toContain('Graph scope: compacted');
  expect(txt).toContain('Analytics scope: retained-subgraph');
  expect(txt).toContain(`Whole-analysis resolution gaps: ${legacy ? 'unknown' : '500'}`);
  expect(txt).not.toContain('All extracted relationships resolved.');
});
