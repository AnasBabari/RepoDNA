import { afterEach, describe, expect, it } from 'vitest';

import {
  isPublicArtifactCacheConfigured,
  PUBLIC_ARTIFACT_TTL_SECONDS,
  publicArtifactPath,
  summarizePublicArtifact,
} from '../../app/lib/analyzer/v2/artifact-cache';
import type { RepoDNAProjectV2 } from '../../app/lib/analyzer/v2/types';

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
  it('uses a deterministic commit-scoped cache key', () => {
    const path = publicArtifactPath({
      owner: 'Graphify-Labs',
      repo: 'Graphify Repo',
      commitSha: 'ABC123def456',
    });
    expect(path).toBe(
      'repodna/public/graphify-labs/graphify-repo/abc123def456/2.0.0/repodna-v2.json'
    );
  });

  it('summarizes an artifact without including graph payloads', () => {
    const project = {
      schemaVersion: '2.0.0',
      coverage: { percentage: 87 },
      nodes: [{ id: 'node-1' }, { id: 'node-2' }],
      edges: [{ id: 'edge-1' }],
      unresolved: [{ edgeId: 'edge-2' }],
      completeness: { status: 'MOSTLY_MAPPED', reasons: ['unresolved relationships'] },
      inventory: { totalFileCount: 412 },
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
