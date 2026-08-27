import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchGitHubRepo } from '../../app/lib/analyzer/ingestion';
import { IngestionError } from '../../app/lib/analyzer/types';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Large-repository Git Tree ingestion', () => {
  it('produces truthful inventory for a mocked >25 MiB repository with mixed file types and truncated tree', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://api.github.com/repos/owner/huge-repo') {
        return new Response(JSON.stringify({ name: 'huge-repo', default_branch: 'main', size: 120_000 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/repos/owner/huge-repo/commits/main')) {
        return new Response(JSON.stringify({ sha: 'commit-sha-abc', commit: { tree: { sha: 'root-tree-sha' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/git/trees/commit-sha-abc?recursive=1')) {
        return new Response(JSON.stringify({ sha: 'root-tree-sha', truncated: true, tree: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/git/trees/root-tree-sha')) {
        return new Response(
          JSON.stringify({
            truncated: true,
            tree: [
              { path: 'src', type: 'tree', sha: 'src-sha' },
              { path: 'src/main.py', type: 'blob', sha: 'blob-main', size: 800 },
              { path: 'src/large.py', type: 'blob', sha: 'blob-large', size: 2_500_000 },
              { path: 'src/generated/bundle.js', type: 'blob', sha: 'blob-gen', size: 400 },
              { path: 'node_modules/lib.js', type: 'blob', sha: 'blob-ignored', size: 300 },
              { path: 'src/binary.py', type: 'blob', sha: 'blob-binary', size: 50 },
              { path: 'README.txt', type: 'blob', sha: 'blob-readme', size: 100 },
              { path: 'deep/nested/file.py', type: 'blob', sha: 'blob-nested', size: 600 },
              {
                path: 'a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z/aa/bb/cc/dd/ee/ff/gg/hh/file.py',
                type: 'blob',
                sha: 'blob-deep',
                size: 10,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.includes('/git/trees/src-sha')) {
        return new Response(
          JSON.stringify({
            truncated: false,
            tree: [{ path: 'helper.py', type: 'blob', sha: 'blob-helper', size: 200 }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.includes('raw.githubusercontent.com')) {
        if (url.includes('README.txt')) return new Response('readme', { status: 200 });
        if (url.includes('src/binary.py')) return new Response('binary\0data', { status: 200 });
        if (url.includes('deep/nested/file.py')) return new Response('print("nested")', { status: 200 });
        if (url.includes('src/helper.py')) return new Response('helper', { status: 200 });
        if (url.includes('src/main.py')) return new Response('print("main")', { status: 200 });
        return new Response('not found', { status: 404 });
      }
      return new Response('not found', { status: 404 });
    });

    const result = await fetchGitHubRepo('https://github.com/owner/huge-repo', {
      maxFiles: 100,
      maxArchiveEntries: 100,
      maxFileBytes: 1_000_000,
      maxArchiveBytes: 100,
      maxTotalExtractedBytes: 10_000_000,
      fetchTimeoutMs: 2000,
      treeFirstSizeKb: 50_000,
    });

    expect(result.inventory).toBeDefined();
    expect(result.inventory?.acquisitionMode).toBe('git-tree');
    expect(result.inventory?.repositorySizeKb).toBe(120_000);
    expect(result.inventory?.totalFileCount).toBeGreaterThanOrEqual(9);
    expect(result.inventory?.ignoredFileCount).toBe(1);
    expect(result.inventory?.generatedFileCount).toBe(1);
    expect(result.inventory?.candidateFileCount).toBeGreaterThanOrEqual(3);
    expect(result.inventory?.firstPartySourceFileCount).toBeGreaterThanOrEqual(3);
    expect(result.inventory?.skippedByReason).toBeDefined();
    expect(result.inventory?.skippedByReason['exceeds_file_size_limit']).toBeGreaterThanOrEqual(1);
    expect(result.inventory?.skippedByReason['binary']).toBeGreaterThanOrEqual(1);
    expect(result.inventory?.skippedByReason['path_too_deep']).toBeGreaterThanOrEqual(1);
    expect(result.inventory?.truncation?.hitLimits).toContain('GITHUB_TREE_TRUNCATED');
    expect(result.inventory?.totalArchiveEntries).toBeGreaterThan(0);

    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toContain('src/main.py');
    expect(paths).toContain('deep/nested/file.py');
    expect(paths).toContain('src/helper.py');
    expect(paths).not.toContain('src/large.py');
    expect(paths).not.toContain('node_modules/lib.js');
    expect(paths).not.toContain('src/generated/bundle.js');
    expect(paths).not.toContain('src/binary.py');

    expect(fetchMock).toHaveBeenCalled();
  });

  it('retries transient GitHub errors with exponential backoff and still succeeds', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    let metadataAttempts = 0;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/repos/owner/retry-repo') && !url.includes('/git/') && !url.includes('/commits')) {
        metadataAttempts++;
        if (metadataAttempts === 1) {
          return new Response('Bad Gateway', { status: 502 });
        }
        return new Response(JSON.stringify({ name: 'retry-repo', default_branch: 'main', size: 10 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('codeload.github.com')) {
        return new Response('fake zip', { status: 404 });
      }
      if (url.includes('/zipball/')) {
        return new Response('fake zip api', { status: 404 });
      }
      return new Response('not found', { status: 404 });
    });

    const result = await fetchGitHubRepo('https://github.com/owner/retry-repo', {
      maxFiles: 10,
      maxArchiveEntries: 100,
      maxFileBytes: 1_000_000,
      maxArchiveBytes: 100,
      maxTotalExtractedBytes: 5000,
      fetchTimeoutMs: 2000,
      treeFirstSizeKb: 5,
    }).catch((e) => e as IngestionError);

    expect(metadataAttempts).toBe(2);
    expect(result).toBeInstanceOf(IngestionError);
  });

  it('preserves accurate skippedByReason and does not silently drop truncated information', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://api.github.com/repos/owner/trunc-repo') {
        return new Response(JSON.stringify({ name: 'trunc-repo', default_branch: 'main', size: 60_000 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/commits/main')) {
        return new Response(JSON.stringify({ sha: 'commit-sha', commit: { tree: { sha: 'root-sha' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/git/trees/commit-sha?recursive=1')) {
        return new Response(JSON.stringify({ sha: 'root-sha', truncated: true, tree: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/git/trees/root-sha')) {
        return new Response(
          JSON.stringify({
            truncated: true,
            tree: [{ path: 'a.py', type: 'blob', sha: 'a-blob', size: 10 }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.includes('raw.githubusercontent.com') && url.includes('a.py')) {
        return new Response('print(1)', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const result = await fetchGitHubRepo('https://github.com/owner/trunc-repo', {
      maxFiles: 100,
      maxArchiveEntries: 100,
      maxFileBytes: 1_000_000,
      maxArchiveBytes: 100,
      maxTotalExtractedBytes: 5000,
      fetchTimeoutMs: 2000,
      treeFirstSizeKb: 50_000,
    });

    expect(result.inventory?.truncation?.hitLimits).toContain('GITHUB_TREE_TRUNCATED');
    expect(result.inventory?.acquisitionMode).toBe('git-tree');
  });
});
