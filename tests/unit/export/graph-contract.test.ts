import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';

import { compactStableStringify, stableStringify } from '../../../app/lib/export/graph/stable-json';
import { graphExportFilename, sanitizeFilenameSegment } from '../../../app/lib/export/graph';
import { computeSourceArtifactDigest, normalizeArtifactForExport } from '../../../app/lib/export/graph/normalize';
import { GraphExportError } from '../../../app/lib/export/graph/types';
import { makeSyntheticFixture, makeV2Fixture } from './fixtures';

function reorderKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(reorderKeys);
  const input = value as Record<string, unknown>;
  const reversed = Object.keys(input).reverse();
  const output: Record<string, unknown> = {};
  for (const key of reversed) output[key] = reorderKeys(input[key]);
  return output;
}

describe('graph export contract', () => {
  it('sorts all collections by id ascending codepoint order', async () => {
    const shuffled = makeV2Fixture();
    shuffled.nodes = [...shuffled.nodes].reverse();
    shuffled.edges = [...shuffled.edges].reverse();
    shuffled.architecture.components = [...shuffled.architecture.components].reverse();
    shuffled.communities = [...shuffled.communities].reverse();
    const { document } = await normalizeArtifactForExport(shuffled);
    expect(document.nodes.map((node) => node.id)).toEqual([...document.nodes.map((node) => node.id)].sort());
    expect(document.relationships.map((edge) => edge.id)).toEqual(
      [...document.relationships.map((edge) => edge.id)].sort()
    );
    expect(document.groups.map((group) => group.id)).toEqual([...document.groups.map((group) => group.id)].sort());
    expect(document.groupMemberships.map((entry) => `${entry.groupId}\u0000${entry.nodeId}`)).toEqual(
      [...document.groupMemberships.map((entry) => `${entry.groupId}\u0000${entry.nodeId}`)].sort()
    );
    expect(document.unresolved.map((item) => item.edgeId)).toEqual(
      [...document.unresolved.map((item) => item.edgeId)].sort()
    );
  });

  it('is deterministic across repeated normalization and digest', async () => {
    const artifact = makeV2Fixture();
    const first = await normalizeArtifactForExport(artifact);
    const second = await normalizeArtifactForExport(structuredClone(artifact));
    expect(stableStringify(first.document, 2)).toBe(stableStringify(second.document, 2));
    expect(first.sourceDigest).toBe(second.sourceDigest);
    expect(compactStableStringify(first.document)).toBe(compactStableStringify(second.document));
  });

  it('produces identical digest regardless of object key insertion order', async () => {
    const artifact = makeV2Fixture();
    const reordered = reorderKeys(structuredClone(artifact)) as typeof artifact;
    const originalDigest = await computeSourceArtifactDigest(artifact);
    const reorderedDigest = await computeSourceArtifactDigest(reordered);
    expect(reorderedDigest).toBe(originalDigest);
  });

  it('normalizes the real v1 demo artifact as legacy-adapted with no invented evidence beyond the adapter', async () => {
    const raw = JSON.parse(readFileSync('public/demo-project.json', 'utf8')) as unknown;
    const { document, adaptedFromLegacy, sourceDigest } = await normalizeArtifactForExport(raw as never);
    expect(adaptedFromLegacy).toBe(true);
    expect(document.manifest.sourceSchemaVersion).toBe('1.1.0');
    expect(document.manifest.adaptedFromLegacy).toBe(true);
    expect(document.manifest.sourceArtifactSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(document.manifest.sourceArtifactSha256).toBe(sourceDigest);
    expect(document.manifest.executedRepositoryCode).toBe(false);
    expect(document.manifest.ordering).toBe('stable-id-ascending');
    expect(document.nodes.length).toBeGreaterThan(0);
    expect(document.relationships.length).toBeGreaterThan(0);
    expect((document as unknown as Record<string, unknown>).exportedAt).toBeUndefined();
    for (const relationship of document.relationships) {
      expect(relationship.why.length).toBeGreaterThan(0);
      expect(relationship.evidenceFile).toBeTruthy();
    }
  });

  it('manifest counts match every collection and stable-json drops undefined', async () => {
    const { document } = await normalizeArtifactForExport(makeV2Fixture());
    expect(document.manifest.counts.nodes).toBe(document.nodes.length);
    expect(document.manifest.counts.relationships).toBe(document.relationships.length);
    expect(document.manifest.counts.groups).toBe(document.groups.length);
    expect(document.manifest.counts.groupMemberships).toBe(document.groupMemberships.length);
    expect(document.manifest.counts.unresolved).toBe(document.unresolved.length);
    expect(JSON.parse(stableStringify({ a: 1, b: undefined, c: null }))).toEqual({ a: 1, c: null });
    expect(compactStableStringify({ z: 2, a: 1 })).toBe('{"a":1,"z":2}');
  });

  it('derives community and architecture group memberships, including shared paths', async () => {
    const { document } = await normalizeArtifactForExport(makeV2Fixture());
    expect(document.groups.map((group) => group.id)).toEqual(
      expect.arrayContaining(['community:0', 'architecture:comp-api'])
    );
    const apiMemberships = document.groupMemberships.filter((entry) => entry.groupId === 'architecture:comp-api');
    expect(apiMemberships.map((entry) => entry.nodeId)).toEqual(expect.arrayContaining(['n-file-a', 'n-class-c']));
    expect(document.groupMemberships.every((entry) => entry.membershipReason === 'community-detection' || entry.membershipReason === 'architecture-file-membership')).toBe(true);
    const membershipIds = new Set(document.groupMemberships.map((entry) => `${entry.groupId}\u0000${entry.nodeId}`));
    expect(membershipIds.size).toBe(document.groupMemberships.length);
  });

  it('enriches unresolved entries with the recorded reason and merged candidates', async () => {
    const { document } = await normalizeArtifactForExport(makeV2Fixture());
    const unresolved = document.unresolved.find((entry) => entry.edgeId === 'e-calls');
    expect(unresolved?.reason).toBe('unresolved call');
    expect(unresolved?.candidateIds).toEqual(['n-class-c']);
    expect(unresolved?.unresolvedExpression).toBe('mystery()');
    const ambiguous = document.unresolved.find((entry) => entry.edgeId === 'e-ambig');
    expect(ambiguous?.reason).toBe('status:ambiguous');
    expect(ambiguous?.candidateIds).toEqual(['n-class-c', 'n-file-a']);
  });

  it('fails closed on a dangling relationship target', async () => {
    const artifact = makeV2Fixture();
    artifact.edges.push({
      id: 'e-dangling',
      source: 'n-file-a',
      target: 'missing-node',
      type: 'CALLS',
      status: 'resolved',
      confidence: 0.9,
      evidence: { file: 'src/a.py', range: { startLine: 1, startCol: 0, endLine: 1, endCol: 0 } },
      explanation: 'dangling',
      resolver: { name: 'test', version: '1.0.0' },
    });
    await expect(normalizeArtifactForExport(artifact)).rejects.toBeInstanceOf(GraphExportError);
    await expect(normalizeArtifactForExport(artifact)).rejects.toMatchObject({ code: 'EXPORT_GRAPH_INVALID' });
  });

  it('fails closed on duplicate node ids', async () => {
    const artifact = makeV2Fixture();
    artifact.nodes.push({ ...artifact.nodes[0] });
    await expect(normalizeArtifactForExport(artifact)).rejects.toMatchObject({ code: 'EXPORT_GRAPH_INVALID' });
  });

  it('fails closed when a resolved relationship has a null target', async () => {
    const artifact = makeV2Fixture();
    artifact.edges[0].target = null;
    artifact.edges[0].status = 'resolved';
    await expect(normalizeArtifactForExport(artifact)).rejects.toMatchObject({ code: 'EXPORT_GRAPH_INVALID' });
  });

  it('sanitizes filenames, caps at 120 chars, and falls back to digest when commit is null', async () => {
    const { document } = await normalizeArtifactForExport(makeV2Fixture());
    const filename = graphExportFilename(document.manifest, 'graph-json');
    expect(filename.length).toBeLessThanOrEqual(120);
    expect(filename).toMatch(/\.json$/);
    expect(sanitizeFilenameSegment('repo with "quotes" & spaces\u0000')).toBe('repo-with-quotes-spaces');
    expect(sanitizeFilenameSegment('!!!')).toBe('repository');

    const noCommit = makeV2Fixture({
      repository: { ...makeV2Fixture().repository, commitSha: null },
    });
    const withoutCommit = await normalizeArtifactForExport(noCommit);
    expect(graphExportFilename(withoutCommit.document.manifest, 'csv')).toMatch(/^[a-z0-9._-]+\.zip$/);
    expect(withoutCommit.document.manifest.repository.commitSha).toBeNull();
  });

  it('produces a document that validates against the JSON schema', async () => {
    const schema = JSON.parse(readFileSync('schema/repodna-graph-export-v1.schema.json', 'utf8')) as object;
    const ajv = new Ajv({ strict: true });
    const validate = ajv.compile(schema);
    const { document } = await normalizeArtifactForExport(makeV2Fixture());
    expect(validate(document)).toBe(true);
  });

  it('remains fast for the large synthetic graph fixture', async () => {
    const synthetic = makeSyntheticFixture(800, 1200);
    const started = Date.now();
    const { document } = await normalizeArtifactForExport(synthetic);
    expect(document.nodes.length).toBe(800);
    expect(document.relationships.length).toBe(1200);
    expect(Date.now() - started).toBeLessThan(2500);
  });
});
