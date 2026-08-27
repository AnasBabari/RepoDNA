import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { parquetMetadata, parquetReadObjects } from 'hyparquet';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

import { buildCsvBundle } from '../../../app/lib/export/graph/csv';
import { buildCypher } from '../../../app/lib/export/graph/cypher';
import { buildGraphJson } from '../../../app/lib/export/graph/json';
import { normalizeArtifactForExport } from '../../../app/lib/export/graph/normalize';
import { buildParquetBundle } from '../../../app/lib/export/graph/parquet';
import { stableStringify, utf8Bytes } from '../../../app/lib/export/graph/stable-json';
import { makeSecurityFixture, makeSyntheticFixture, makeV2Fixture } from './fixtures';

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function asAsyncBuffer(bytes: Uint8Array) {
  const copy = bytes.slice();
  return {
    byteLength: copy.byteLength,
    slice(start: number, end?: number) {
      return asArrayBuffer(copy.slice(start, end));
    },
  };
}

describe('graph export serializers', () => {
  it('produces deterministic byte-identical JSON, CSV, Cypher, and Parquet', async () => {
    const artifact = makeV2Fixture();
    const first = await normalizeArtifactForExport(artifact);
    const second = await normalizeArtifactForExport(structuredClone(artifact));

    const [jsonA, jsonB] = await Promise.all([buildGraphJson(first.document), buildGraphJson(second.document)]);
    expect(Buffer.from(jsonA.bytes).toString('utf8')).toBe(Buffer.from(jsonB.bytes).toString('utf8'));
    expect(jsonA.sha256).toBe(jsonB.sha256);
    expect(jsonA.filename).toBe(jsonB.filename);

    const [csvA, csvB] = await Promise.all([buildCsvBundle(first.document), buildCsvBundle(second.document)]);
    expect(Buffer.from(csvA.bytes).equals(Buffer.from(csvB.bytes))).toBe(true);
    expect(csvA.sha256).toBe(csvB.sha256);

    const [cypherA, cypherB] = await Promise.all([buildCypher(first.document), buildCypher(second.document)]);
    expect(Buffer.from(cypherA.bytes).toString('utf8')).toBe(Buffer.from(cypherB.bytes).toString('utf8'));
    expect(cypherA.sha256).toBe(cypherB.sha256);

    const [parquetA, parquetB] = await Promise.all([
      buildParquetBundle(first.document),
      buildParquetBundle(second.document),
    ]);
    expect(Buffer.from(parquetA.bytes).equals(Buffer.from(parquetB.bytes))).toBe(true);
    expect(parquetA.sha256).toBe(parquetB.sha256);
  });

  it('produces valid JSON that validates against the schema', async () => {
    const schema = JSON.parse(readFileSync('schema/repodna-graph-export-v1.schema.json', 'utf8')) as object;
    const ajv = new Ajv({ strict: true });
    const validate = ajv.compile(schema);
    const { document } = await normalizeArtifactForExport(makeV2Fixture());
    const file = await buildGraphJson(document);
    const parsed = JSON.parse(Buffer.from(file.bytes).toString('utf8')) as unknown;
    expect(validate(parsed)).toBe(true);
    expect(file.mediaType).toBe('application/vnd.repodna.graph+json; charset=utf-8');
    expect(file.filename).toMatch(/-repodna-graph\.json$/);
    expect(JSON.parse(stableStringify(parsed, 2))).toEqual(parsed);
  });

  it('produces a CSV bundle with all required files and correct escaping', async () => {
    const { document } = await normalizeArtifactForExport(makeSecurityFixture());
    const file = await buildCsvBundle(document);
    expect(file.mediaType).toBe('application/zip');
    expect(file.filename).toMatch(/-repodna-csv\.zip$/);

    const unzipped = unzipSync(file.bytes);
    expect(Object.keys(unzipped).sort()).toEqual([
      'group_memberships.csv',
      'groups.csv',
      'manifest.json',
      'nodes.csv',
      'relationships.csv',
      'unresolved.csv',
    ]);

    const manifest = JSON.parse(Buffer.from(unzipped['manifest.json']).toString('utf8')) as {
      counts: Record<string, number>;
      files: Array<{ name: string; sha256: string }>;
      csvFormulaEscaping: string;
    };
    expect(manifest.csvFormulaEscaping).toBe('apostrophe-prefix-on-formula-leading-characters');
    expect(manifest.counts.nodes).toBe(document.nodes.length);
    expect(manifest.files.some((entry) => entry.name === 'nodes.csv')).toBe(true);

    const nodesCsv = Buffer.from(unzipped['nodes.csv']).toString('utf8');
    expect(nodesCsv).toContain('\r\n');
    expect(nodesCsv.split('\r\n')[0]).toBe(
      'id,kind,name,qualified_name,path,language,start_line,start_col,end_line,end_col,confidence,evidence_json,properties_json,community_ids_json,architecture_group_ids_json'
    );
    expect(nodesCsv).toContain('""');
    expect(nodesCsv).toContain("'=cmd");

    const relationshipsCsv = Buffer.from(unzipped['relationships.csv']).toString('utf8');
    expect(relationshipsCsv.split('\r\n')[0]).toBe(
      'id,source_id,source_name,source_kind,source_path,target_id,target_name,target_kind,target_path,type,status,confidence,why,evidence_file,evidence_start_line,evidence_start_col,evidence_end_line,evidence_end_col,resolver_name,resolver_version,alternative_candidate_ids_json,unresolved_expression,properties_json'
    );
    const csvA2 = await buildCsvBundle(document);
    expect(Buffer.from(file.bytes).equals(Buffer.from(csvA2.bytes))).toBe(true);
  });

  it('produces five readable Parquet tables with manifest parity and null preservation', async () => {
    const { document } = await normalizeArtifactForExport(makeSecurityFixture());
    const file = await buildParquetBundle(document);
    expect(file.mediaType).toBe('application/zip');
    expect(file.filename).toMatch(/-repodna-parquet\.zip$/);

    const unzipped = unzipSync(file.bytes);
    const filenames = Object.keys(unzipped).sort();
    expect(filenames).toEqual([
      'group_memberships.parquet',
      'groups.parquet',
      'manifest.json',
      'nodes.parquet',
      'relationships.parquet',
      'unresolved.parquet',
    ]);

    const manifest = JSON.parse(Buffer.from(unzipped['manifest.json']).toString('utf8')) as {
      format: string;
      counts: Record<string, number>;
      files: Array<{ name: string; byteSize: number; sha256: string }>;
      parquet: { tables: Array<{ name: string; columns: Array<{ name: string; type: string }> }> };
    };
    expect(manifest.format).toBe('parquet');
    expect(manifest.counts.nodes).toBe(document.nodes.length);
    expect(manifest.counts.relationships).toBe(document.relationships.length);
    expect(manifest.parquet.tables).toHaveLength(5);
    expect(manifest.parquet.tables.find((table) => table.name === 'relationships')?.columns).toEqual(
      expect.arrayContaining([
        { name: 'source_id', type: 'STRING', nullable: true },
        { name: 'target_id', type: 'STRING', nullable: true },
        { name: 'why', type: 'STRING', nullable: true },
        { name: 'properties_json', type: 'STRING', nullable: true },
      ])
    );

    const rowCounts: Record<string, number> = {
      'nodes.parquet': document.nodes.length,
      'relationships.parquet': document.relationships.length,
      'groups.parquet': document.groups.length,
      'group_memberships.parquet': document.groupMemberships.length,
      'unresolved.parquet': document.unresolved.length,
    };
    for (const [filename, expectedRows] of Object.entries(rowCounts)) {
      const bytes = unzipped[filename];
      const metadata = parquetMetadata(asArrayBuffer(bytes));
      expect(Number(metadata.num_rows)).toBe(expectedRows);
      const entry = manifest.files.find((candidate) => candidate.name === filename);
      expect(entry?.byteSize).toBe(bytes.byteLength);
      expect(entry?.sha256).toMatch(/^[0-9a-f]{64}$/);
    }

    const relationshipBytes = unzipped['relationships.parquet'];
    const relationshipRows = await parquetReadObjects({
      file: asAsyncBuffer(relationshipBytes),
      columns: ['id', 'target_id', 'why', 'properties_json'],
      rowFormat: 'object',
    });
    expect(relationshipRows).toHaveLength(document.relationships.length);
    expect(relationshipRows.some((row) => row.target_id === null)).toBe(true);
    expect(relationshipRows.every((row) => typeof row.why === 'string' && row.why.length > 0)).toBe(true);
    expect(relationshipRows.every((row) => typeof row.properties_json === 'string')).toBe(true);
  });

  it('protects spreadsheet formula injection in CSV cells', async () => {
    const artifact = makeV2Fixture();
    artifact.nodes[0].name = '=cmd|"/c calc"!A1';
    artifact.nodes[0].qualifiedName = '+SUM(A1:A9)';
    artifact.edges[0].explanation = '@SUM(A1)';
    const { document } = await normalizeArtifactForExport(artifact);
    const file = await buildCsvBundle(document);
    const unzipped = unzipSync(file.bytes);
    const nodesCsv = Buffer.from(unzipped['nodes.csv']).toString('utf8');
    const relCsv = Buffer.from(unzipped['relationships.csv']).toString('utf8');
    expect(nodesCsv).toContain("'=cmd");
    expect(nodesCsv).toContain("'+SUM");
    expect(relCsv).toContain("'@SUM");
  });

  it('produces Cypher with constraints, batches, MERGE idempotency, and no destructive statements', async () => {
    const { document } = await normalizeArtifactForExport(makeV2Fixture());
    const file = await buildCypher(document);
    const text = Buffer.from(file.bytes).toString('utf8');
    expect(file.mediaType).toBe('text/plain; charset=utf-8');
    expect(file.filename).toMatch(/-repodna-cypher\.txt$/);
    expect(text).toContain('CREATE CONSTRAINT repo_dna_entity_id IF NOT EXISTS FOR (n:RepoDNAEntity) REQUIRE n.id IS UNIQUE;');
    expect(text).toContain('CREATE CONSTRAINT repo_dna_group_id');
    expect(text).toContain('CREATE CONSTRAINT repo_dna_unresolved_id');
    expect(text).toContain('UNWIND [');
    expect(text).toContain('MERGE (n:RepoDNAEntity:');
    expect(text).toContain('MERGE (source)-[r:');
    expect(text).not.toMatch(/\bCREATE\s+\(n:/);
    expect(text).not.toMatch(/DETACH\s+DELETE/i);
    expect(text).not.toMatch(/DROP\s+CONSTRAINT/i);
    const batches = text.split('UNWIND [').length - 1;
    expect(batches).toBeGreaterThan(0);
  });

  it('escapes Cypher string literals and handles synthetic unresolved placeholders', async () => {
    const { document } = await normalizeArtifactForExport(makeSecurityFixture());
    const file = await buildCypher(document);
    const text = Buffer.from(file.bytes).toString('utf8');
    expect(text).toContain("\\'");
    expect(text).toContain('\\\\');
    expect(text).toContain('\\n');
    expect(text).toContain('\\u0000');
    expect(text).toContain('RepoDNAUnresolved');
    expect(text).toContain('syntheticTarget = true');
    expect(text).toContain('syntheticTarget = false');
    expect(text).not.toContain("'} ) DETACH DELETE");
  });

  it('chunks Cypher batches at 500 rows', async () => {
    const synthetic = makeSyntheticFixture(1200, 0);
    const { document } = await normalizeArtifactForExport(synthetic);
    const file = await buildCypher(document);
    const text = Buffer.from(file.bytes).toString('utf8');
    const unwindBlocks = text.split('UNWIND [').slice(1);
    for (const block of unwindBlocks) {
      const rows = block.split('\n').filter((line) => line.trim().startsWith('{')).length;
      expect(rows).toBeLessThanOrEqual(500);
    }
  });

  it('stores complete provenance on every relationship', async () => {
    const { document } = await normalizeArtifactForExport(makeV2Fixture());
    const file = await buildCypher(document);
    const text = Buffer.from(file.bytes).toString('utf8');
    expect(text).toContain('r.why = row.why');
    expect(text).toContain('r.evidenceFile = row.evidenceFile');
    expect(text).toContain('r.resolverName = row.resolverName');
    expect(text).toContain('r.alternativeCandidateIdsJson = row.alternativeCandidateIdsJson');
    expect(text).toContain('r.propertiesJson = row.propertiesJson');

    const csvFile = await buildCsvBundle(document);
    const unzipped = unzipSync(csvFile.bytes);
    const relCsv = Buffer.from(unzipped['relationships.csv']).toString('utf8');
    expect(relCsv).toContain('why');
    expect(relCsv).toContain('evidence_file');
    expect(relCsv).toContain('resolver_name');
  });

  it('handles the large synthetic fixture without excessive time', async () => {
    const synthetic = makeSyntheticFixture(800, 1200);
    const { document } = await normalizeArtifactForExport(synthetic);
    const start = Date.now();
    const [json, csv, cypher] = await Promise.all([buildGraphJson(document), buildCsvBundle(document), buildCypher(document)]);
    expect(json.byteSize).toBeGreaterThan(0);
    expect(csv.byteSize).toBeGreaterThan(0);
    expect(cypher.byteSize).toBeGreaterThan(0);
    expect(Date.now() - start).toBeLessThan(4000);
    expect(utf8Bytes(JSON.stringify({ a: 1 })).length).toBeGreaterThan(0);
  });
});
