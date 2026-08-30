import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeV2Fixture } from './export/fixtures';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@vercel/blob', () => mocks);

import {
  MAX_PUBLIC_ARTIFACT_BYTES,
  readCachedPublicArtifact,
  storePublicArtifact,
} from '../../app/lib/analyzer/v2/artifact-cache';

const cacheKey = { owner: 'owner', repo: 'repo', commitSha: 'a'.repeat(40) };

describe('public artifact cache integrity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
    mocks.del.mockResolvedValue(undefined);
    mocks.put.mockResolvedValue({ url: 'private-url', pathname: 'repodna/public/artifact.json' });
  });

  it('evicts malformed cached JSON instead of trusting it', async () => {
    mocks.get.mockResolvedValue({
      statusCode: 200,
      blob: { uploadedAt: new Date(), url: 'private-url', size: 8 },
      stream: new Blob(['not json']).stream(),
    });

    await expect(readCachedPublicArtifact(cacheKey)).resolves.toBeNull();
    expect(mocks.del).toHaveBeenCalledOnce();
  });

  it('evicts cached artifacts whose declared size exceeds the read budget', async () => {
    mocks.get.mockResolvedValue({
      statusCode: 200,
      blob: { uploadedAt: new Date(), url: 'private-url', size: MAX_PUBLIC_ARTIFACT_BYTES + 1 },
      stream: new Blob(['{}']).stream(),
    });

    await expect(readCachedPublicArtifact(cacheKey)).resolves.toBeNull();
    expect(mocks.del).toHaveBeenCalledOnce();
  });

  it('returns a valid cached artifact only after schema validation', async () => {
    const project = makeV2Fixture();
    const serialized = JSON.stringify(project);
    mocks.get.mockResolvedValue({
      statusCode: 200,
      blob: { uploadedAt: new Date(), url: 'private-url', size: new TextEncoder().encode(serialized).byteLength },
      stream: new Blob([serialized]).stream(),
    });

    const cached = await readCachedPublicArtifact(cacheKey);
    expect(cached?.project.schemaVersion).toBe('2.0.0');
    expect(cached?.summary.nodeCount).toBe(project.nodes.length);
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it('rejects invalid artifacts before writing to private Blob storage', async () => {
    const project = makeV2Fixture();
    project.security.executedRepositoryCode = true as never;

    await expect(storePublicArtifact({ ...cacheKey, project })).rejects.toThrow('PUBLIC_ARTIFACT_SCHEMA_INVALID');
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
