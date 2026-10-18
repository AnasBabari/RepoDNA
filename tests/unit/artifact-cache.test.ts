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
function pinnedProject() {
  const project = makeV2Fixture();
  project.repository.source = `https://github.com/owner/repo/tree/${cacheKey.commitSha}`;
  project.repository.analyzedRef = cacheKey.commitSha;
  return project;
}

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
    const project = pinnedProject();
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

  it.each(['commit', 'ref', 'repository', 'private'])('refuses a cached or newly stored %s identity mismatch', async (mismatch) => {
    const project = pinnedProject();
    if (mismatch === 'commit') project.repository.commitSha = 'b'.repeat(40);
    if (mismatch === 'ref') project.repository.analyzedRef = 'HEAD';
    if (mismatch === 'repository') project.repository.source = `https://github.com/other/repo/tree/${cacheKey.commitSha}`;
    if (mismatch === 'private') project.repository.source = 'private:repo';
    const serialized = JSON.stringify(project);
    mocks.get.mockResolvedValue({ statusCode: 200, blob: { uploadedAt: new Date(), url: 'private-url', size: serialized.length }, stream: new Blob([serialized]).stream() });
    await expect(readCachedPublicArtifact(cacheKey)).resolves.toBeNull();
    expect(mocks.del).toHaveBeenCalledOnce();
    await expect(storePublicArtifact({ ...cacheKey, project })).rejects.toThrow('PUBLIC_ARTIFACT_IDENTITY_MISMATCH');
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('rejects invalid artifacts before writing to private Blob storage', async () => {
    const project = makeV2Fixture();
    project.security.executedRepositoryCode = true as never;

    await expect(storePublicArtifact({ ...cacheKey, project })).rejects.toThrow('PUBLIC_ARTIFACT_SCHEMA_INVALID');
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('stores a validated pinned artifact under its immutable commit key', async () => {
    const stored = await storePublicArtifact({ ...cacheKey, project: pinnedProject() });
    expect(stored.project.repository.commitSha).toBe(cacheKey.commitSha);
    expect(mocks.put.mock.calls[0][0]).toContain(`/${cacheKey.commitSha}/2.0.7/`);
    expect(mocks.put.mock.calls[0][2]).toMatchObject({ access: 'private', cacheControlMaxAge: 604800 });
  });
});
