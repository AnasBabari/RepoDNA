import * as fflate from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import {
  extractFromZip,
  fetchGitHubRepo,
  parseGitHubUrl,
} from '../../app/lib/analyzer/ingestion';
import { IngestionError } from '../../app/lib/analyzer/types';

describe('Ingestion & Resource Limits', () => {
  it('validates public GitHub URLs and handles all real-world URL formats with canonical resolution', () => {
    // Standard formats
    expect(parseGitHubUrl('https://github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });
    expect(parseGitHubUrl('https://github.com/owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });
    expect(parseGitHubUrl('http://github.com/owner/repo/')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });
    expect(parseGitHubUrl('owner/repo')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });

    // Missing protocol & www
    expect(parseGitHubUrl('github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });
    expect(parseGitHubUrl('www.github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });
    expect(parseGitHubUrl('https://www.github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });

    // SSH clone formats (colon, slash, port, git+ssh)
    expect(parseGitHubUrl('git@github.com:owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });
    expect(parseGitHubUrl('git@github.com:owner/repo')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });
    expect(parseGitHubUrl('ssh://git@github.com/owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });
    expect(parseGitHubUrl('ssh://git@github.com:22/owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });
    expect(parseGitHubUrl('git+ssh://git@github.com/owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });
    expect(parseGitHubUrl('git+https://github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });

    // Deep branch / tree / blob / issues URLs canonicalize to repo root
    expect(parseGitHubUrl('https://github.com/owner/repo/tree/main')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });
    expect(parseGitHubUrl('https://github.com/owner/repo/tree/feature/nested-path')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });
    expect(parseGitHubUrl('https://github.com/owner/repo/blob/main/src/index.ts')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });
    expect(parseGitHubUrl('https://github.com/owner/repo/issues/42')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });
    expect(parseGitHubUrl('https://github.com/owner/repo/pull/123')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });

    // Query parameters & fragments
    expect(parseGitHubUrl('https://github.com/owner/repo?tab=readme-ov-file')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });
    expect(parseGitHubUrl('https://github.com/owner/repo#readme')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });
    expect(parseGitHubUrl('https://github.com/owner/repo/tree/main?tab=readme-ov-file#install')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });

    // Quoted strings and scoped prefix
    expect(parseGitHubUrl('"https://github.com/owner/repo"')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });
    expect(parseGitHubUrl("'owner/repo'")).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });
    expect(parseGitHubUrl('@owner/repo')).toEqual({ owner: 'owner', repo: 'repo', canonicalUrl: 'https://github.com/owner/repo' });

    // Strict Rejections (SSRF, non-github, credentials, malformed)
    expect(parseGitHubUrl('https://gitlab.com/owner/repo')).toBeNull();
    expect(parseGitHubUrl('https://attacker.github.com.evil.com/owner/repo')).toBeNull();
    expect(parseGitHubUrl('https://github.com.evil.com/owner/repo')).toBeNull();
    expect(parseGitHubUrl('http://169.254.169.254/owner/repo')).toBeNull();
    expect(parseGitHubUrl('http://localhost:3000/owner/repo')).toBeNull();
    expect(parseGitHubUrl('https://user:password@github.com/owner/repo')).toBeNull();
    expect(parseGitHubUrl('ftp://github.com/owner/repo')).toBeNull();
    expect(parseGitHubUrl('https://github.com/settings')).toBeNull();
    expect(parseGitHubUrl('https://github.com/explore')).toBeNull();
    expect(parseGitHubUrl('https://github.com/invalid url/repo')).toBeNull();
    expect(parseGitHubUrl('')).toBeNull();
  });

  it('falls back to Git tree and raw files when the generated archive exceeds the compressed limit', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(new Response('oversized archive', { status: 200, headers: { 'content-length': '101' } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: 'large', default_branch: 'main' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sha: 'commit-sha', commit: { tree: { sha: 'tree-sha' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            truncated: false,
            tree: [
              { path: 'src/main.py', type: 'blob', sha: 'blob-python', size: 12 },
              { path: 'README.txt', type: 'blob', sha: 'blob-readme', size: 24 },
              { path: 'node_modules/ignored.js', type: 'blob', sha: 'blob-ignored', size: 10 },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(new Response('print("ok")', { status: 200 }));

    try {
      const result = await fetchGitHubRepo('https://github.com/owner/large', {
        maxFiles: 100,
        maxArchiveEntries: 100,
        maxFileBytes: 1000,
        maxArchiveBytes: 100,
        maxTotalExtractedBytes: 5000,
        fetchTimeoutMs: 1000,
      });

      expect(result.files.map((file) => file.path)).toEqual(['src/main.py']);
      expect(result.inventory).toMatchObject({
        totalFileCount: 3,
        candidateFileCount: 1,
        firstPartySourceFileCount: 1,
        ignoredFileCount: 1,
      });
      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
        'https://codeload.github.com/owner/large/zip/HEAD',
        'https://api.github.com/repos/owner/large',
        'https://api.github.com/repos/owner/large/commits/main',
        'https://api.github.com/repos/owner/large/git/trees/commit-sha?recursive=1',
        'https://raw.githubusercontent.com/owner/large/commit-sha/src/main.py',
      ]);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('selects Git-tree acquisition before codeload for a known large public repository', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: 'large', default_branch: 'main', size: 75_000 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sha: 'commit-sha' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            truncated: false,
            tree: [{ path: 'src/main.py', type: 'blob', sha: 'blob-python', size: 12 }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(new Response('print("ok")', { status: 200 }));

    try {
      const result = await fetchGitHubRepo('https://github.com/owner/large', {
        maxFiles: 100,
        maxArchiveEntries: 100,
        maxFileBytes: 1000,
        maxArchiveBytes: 100,
        maxTotalExtractedBytes: 5000,
        fetchTimeoutMs: 1000,
        treeFirstSizeKb: 50_000,
      });

      expect(result.files.map((file) => file.path)).toEqual(['src/main.py']);
      expect(result.inventory).toMatchObject({
        acquisitionMode: 'git-tree',
        repositorySizeKb: 75_000,
      });
      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
        'https://api.github.com/repos/owner/large',
        'https://api.github.com/repos/owner/large/commits/main',
        'https://api.github.com/repos/owner/large/git/trees/commit-sha?recursive=1',
        'https://raw.githubusercontent.com/owner/large/commit-sha/src/main.py',
      ]);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('walks from the returned root tree when a pinned recursive tree is truncated', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: 'large', default_branch: 'main', size: 75_000 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sha: 'root-tree-sha', truncated: true, tree: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tree: [{ path: 'src/main.py', type: 'blob', sha: 'blob-python', size: 12 }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(new Response('print("ok")', { status: 200 }));

    try {
      const result = await fetchGitHubRepo(
        'https://github.com/owner/large',
        {
          maxFiles: 100,
          maxArchiveEntries: 100,
          maxFileBytes: 1000,
          maxArchiveBytes: 100,
          maxTotalExtractedBytes: 5000,
          fetchTimeoutMs: 1000,
          treeFirstSizeKb: 50_000,
        },
        undefined,
        { commitSha: 'commit-sha' }
      );

      expect(result.files).toHaveLength(1);
      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
        'https://api.github.com/repos/owner/large',
        'https://api.github.com/repos/owner/large/git/trees/commit-sha?recursive=1',
        'https://api.github.com/repos/owner/large/git/trees/root-tree-sha',
        'https://raw.githubusercontent.com/owner/large/commit-sha/src/main.py',
      ]);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('keeps a truthful partial inventory when public candidate files exceed the soft limit', async () => {
    const buffer = fflate.zipSync({
      'one.py': fflate.strToU8('print(1)'),
      'two.py': fflate.strToU8('print(2)'),
    });

    const result = await extractFromZip(buffer, 'large-repo', {
      maxFiles: 1,
      maxArchiveEntries: 100,
      maxFileBytes: 1000,
      maxArchiveBytes: 50000,
      maxTotalExtractedBytes: 50000,
      fetchTimeoutMs: 1000,
      allowPartialOnFileLimit: true,
    });

    expect(result.files).toHaveLength(1);
    expect(result.skipped).toContainEqual({ path: 'two.py', reason: 'max_files_limit' });
    expect(result.inventory).toMatchObject({
      acquisitionMode: 'archive',
      truncation: {
        hitLimits: ['TOO_MANY_FILES'],
        maxFilesReached: true,
        maxBytesReached: false,
      },
    });
  });

  it('rejects archives containing path traversal attempts', async () => {
    const buffer = fflate.zipSync({
      '../evil.py': fflate.strToU8('print("malicious")'),
    });

    await expect(extractFromZip(buffer, 'test-repo')).rejects.toThrow(IngestionError);
    await expect(extractFromZip(buffer, 'test-repo')).rejects.toMatchObject({
      code: 'PATH_TRAVERSAL',
      status: 400,
    });
  });

  it('rejects absolute paths in archive entries', async () => {
    const buffer = fflate.zipSync({
      '/etc/passwd': fflate.strToU8('root:x:0:0'),
    });

    await expect(extractFromZip(buffer, 'test-repo')).rejects.toThrow(IngestionError);
  });

  it('normalizes Windows archive separators before import and route resolution', async () => {
    const buffer = fflate.zipSync({
      'package.json': fflate.strToU8('{"name":"windows-archive"}'),
      'src\\app.js': fflate.strToU8("const router = require('./routes/users');"),
      'src\\routes\\users.js': fflate.strToU8("router.get('/:id', handler);"),
    });

    const result = await extractFromZip(buffer, 'windows-archive');
    expect(result.files.map((file) => file.path).sort()).toEqual([
      'package.json',
      'src/app.js',
      'src/routes/users.js',
    ]);
  });

  it('enforces compressed archive size limit', async () => {
    const buffer = fflate.zipSync({
      'main.py': fflate.strToU8('print("hello")'),
    });

    const customLimits = {
      maxFiles: 100,
      maxArchiveEntries: 100,
      maxFileBytes: 1000,
      maxArchiveBytes: 10, // 10 bytes limit
      maxTotalExtractedBytes: 1000,
      fetchTimeoutMs: 1000,
    };

    await expect(extractFromZip(buffer, 'test-repo', customLimits)).rejects.toMatchObject({
      code: 'ARCHIVE_TOO_LARGE',
      status: 413,
    });
  });

  it('enforces total extracted content limit (ZIP bomb protection)', async () => {
    const buffer = fflate.zipSync({
      'large.py': fflate.strToU8('A'.repeat(5000)),
    });

    const customLimits = {
      maxFiles: 100,
      maxArchiveEntries: 100,
      maxFileBytes: 10000,
      maxArchiveBytes: 50000,
      maxTotalExtractedBytes: 2000, // 2 KB total extracted limit
      fetchTimeoutMs: 1000,
    };

    await expect(extractFromZip(buffer, 'test-repo', customLimits)).rejects.toMatchObject({
      code: 'EXTRACTED_TOO_LARGE',
      status: 413,
    });
  });

  it('enforces maximum candidate file count limit', async () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < 10; i++) {
      entries[`file_${i}.py`] = fflate.strToU8('print(1)');
    }
    const buffer = fflate.zipSync(entries);

    const customLimits = {
      maxFiles: 5, // 5 candidate files limit
      maxArchiveEntries: 100,
      maxFileBytes: 1000,
      maxArchiveBytes: 50000,
      maxTotalExtractedBytes: 50000,
      fetchTimeoutMs: 1000,
    };

    await expect(extractFromZip(buffer, 'test-repo', customLimits)).rejects.toMatchObject({
      code: 'TOO_MANY_FILES',
      status: 413,
    });
  });

  it('skips individual files exceeding single-file limit', async () => {
    const buffer = fflate.zipSync({
      'small.py': fflate.strToU8('print("ok")'),
      'huge.py': fflate.strToU8('A'.repeat(5000)),
    });

    const customLimits = {
      maxFiles: 100,
      maxArchiveEntries: 100,
      maxFileBytes: 100, // 100 bytes single file limit
      maxArchiveBytes: 50000,
      maxTotalExtractedBytes: 50000,
      fetchTimeoutMs: 1000,
    };

    const result = await extractFromZip(buffer, 'test-repo', customLimits);
    expect(result.files.length).toBe(1);
    expect(result.files[0].path).toBe('small.py');
    expect(result.skipped.some((s) => s.path === 'huge.py')).toBe(true);
  });

  it('skips binary files', async () => {
    const buffer = fflate.zipSync({
      'text.py': fflate.strToU8('print(1)'),
      'binary.dat': fflate.strToU8('test\0binary\0data'),
    });

    const result = await extractFromZip(buffer, 'test-repo');
    expect(result.files.map((f) => f.path)).toContain('text.py');
    expect(result.files.map((f) => f.path)).not.toContain('binary.dat');
  });
});
