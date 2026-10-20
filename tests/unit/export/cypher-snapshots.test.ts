import { expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeV2Fixture } from './fixtures';
import { normalizeArtifactForExport } from '../../../app/lib/export/graph/normalize';
import { buildCypher, cypherSnapshotKey } from '../../../app/lib/export/graph/cypher';

it('scopes identical local IDs across repositories and commits and preserves membership evidence', async () => {
  const snapshots = [];
  const output = resolve(process.env.REPODNA_SNAPSHOT_FIXTURE_DIR ?? 'test-results/neo4j-snapshots');
  if (process.env.REPODNA_KEEP_SNAPSHOT_FIXTURES === '1') mkdirSync(output, { recursive: true });
  for (const [index, [owner, sha]] of [['first', 'a'.repeat(40)], ['second', 'a'.repeat(40)], ['first', 'b'.repeat(40)]].entries()) {
    const project = makeV2Fixture();
    project.repository.source = `https://github.com/${owner}/same-paths/tree/${sha}`;
    project.repository.commitSha = sha;
    project.repository.analyzedRef = sha;
    const { document } = await normalizeArtifactForExport(project);
    const key = await cypherSnapshotKey(document);
    const file = await buildCypher(document);
    expect(await cypherSnapshotKey(structuredClone(document))).toBe(key);
    const text = new TextDecoder().decode(file.bytes);
    for (const node of document.nodes) expect(text).toContain(`id: '${key}:${node.id}'`);
    expect(text).toContain('SET r.membershipReason = row.membershipReason');
    expect(text).toContain('manifestBase64:');
    for (const membership of document.groupMemberships) expect(text).toContain(`membershipReason: '${membership.membershipReason}'`);
    expect(document.nodes.map((node) => node.id)).toEqual((await normalizeArtifactForExport(makeV2Fixture())).document.nodes.map((node) => node.id));
    const filename = `${index}.cypher`;
    snapshots.push({ key, filename, manifest: document.manifest });
    if (process.env.REPODNA_KEEP_SNAPSHOT_FIXTURES === '1') writeFileSync(resolve(output, filename), file.bytes);
  }
  expect(new Set(snapshots.map((snapshot) => snapshot.key)).size).toBe(3);
  if (process.env.REPODNA_KEEP_SNAPSHOT_FIXTURES === '1') writeFileSync(resolve(output, 'snapshots.json'), JSON.stringify(snapshots));
});
