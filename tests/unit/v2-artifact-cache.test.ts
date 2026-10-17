import { afterEach, describe, expect, it } from 'vitest';

import {
  isPublicArtifactCacheConfigured,
  PUBLIC_ARTIFACT_TTL_SECONDS,
  publicArtifactPath,
  summarizePublicArtifact,
} from '../../app/lib/analyzer/v2/artifact-cache';
import type { RepoDNAProjectV2 } from '../../app/lib/analyzer/v2/types';
import { makeV2Fixture } from './export/fixtures';
import { graphCounts, recordedGraphScope } from '../../app/lib/graph-scope';

const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
const originalBlobStoreId = process.env.BLOB_STORE_ID;
const originalOidcToken = process.env.VERCEL_OIDC_TOKEN;

afterEach(() => {
  if (originalBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
  if (originalBlobStoreId === undefined) delete process.env.BLOB_STORE_ID;
  else process.env.BLOB_STORE_ID = originalBlobStoreId;
  if (originalOidcToken === undefined) delete process.env.VERCEL_OIDC_TOKEN;
  else process.env.VERCEL_OIDC_TOKEN = originalOidcToken;
});
describe('public v2 artifact cache', () => {
  it('keeps whole-analysis gaps distinct from retained gaps in workflow summaries', () => {
    const project = makeV2Fixture();
    project.edges = [];
    project.unresolved = [];
    project.coverage.truncationReasons = ['GRAPH_EDGES_COMPACTED'];
    project.graphScope = recordedGraphScope({ nodes: 10, relationships: 20, unresolvedRelationships: 6, ambiguousRelationships: 2 }, graphCounts(project));
    expect(summarizePublicArtifact(project)).toMatchObject({ unresolvedCount: 6, retainedUnresolvedCount: 0, completeness: { status: 'COVERAGE_LIMITED' } });
    delete project.graphScope;
    expect(summarizePublicArtifact(project)).toMatchObject({ unresolvedCount: null, retainedUnresolvedCount: 0 });
  });

  it('uses a deterministic commit-scoped cache key', () => {
    const path = publicArtifactPath({
      owner: 'Graphify-Labs',
      repo: 'Graphify Repo',
      commitSha: 'ABC123def456',
    });
    expect(path).toBe(
      'repodna/public/graphify-labs/graphify-repo/abc123def456/2.0.5/repodna-v2.json'
    );
  });

  it('summarizes an artifact without including graph payloads', () => {
    const project = {
      schemaVersion: '2.0.0',
      coverage: { percentage: 87, truncationReasons: [] },
      nodes: [{ id: 'node-1' }, { id: 'node-2' }],
      edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2', status: 'resolved' }],
      unresolved: [{ edgeId: 'edge-2', reason: 'unknown', candidates: [] }],
      completeness: { status: 'MOSTLY_MAPPED', reasons: ['unresolved relationships'] },
      inventory: { totalFileCount: 412 },
      security: { truncated: [] },
      diagnostics: [],
    } as unknown as RepoDNAProjectV2;

    const summary = summarizePublicArtifact(project);
    expect(summary).toMatchObject({
      schemaVersion: '2.0.0',
      coveragePercentage: 87,
      nodeCount: 2,
      edgeCount: 1,
      unresolvedCount: 1,
      inventory: { totalFileCount: 412 },
    });
    expect(summary).not.toHaveProperty('nodes');
    expect(summary).not.toHaveProperty('edges');
  });

  it('accepts either a Blob token or Vercel OIDC store credentials', () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB_STORE_ID;
    delete process.env.VERCEL_OIDC_TOKEN;
    expect(isPublicArtifactCacheConfigured()).toBe(false);

    process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
    expect(isPublicArtifactCacheConfigured()).toBe(true);
    delete process.env.BLOB_READ_WRITE_TOKEN;

    process.env.BLOB_STORE_ID = 'store_test';
    process.env.VERCEL_OIDC_TOKEN = 'oidc-test';
    expect(isPublicArtifactCacheConfigured()).toBe(true);
    expect(PUBLIC_ARTIFACT_TTL_SECONDS).toBe(604_800);
  });
});
