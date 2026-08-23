import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  extractFromZip,
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

  it('rejects archives containing path traversal attempts', async () => {
    const zip = new JSZip();
    zip.file('../evil.py', 'print("malicious")');
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });

    await expect(extractFromZip(buffer, 'test-repo')).rejects.toThrow(IngestionError);
    await expect(extractFromZip(buffer, 'test-repo')).rejects.toMatchObject({
      code: 'PATH_TRAVERSAL',
      status: 400,
    });
  });

  it('rejects absolute paths in archive entries', async () => {
    const zip = new JSZip();
    zip.file('/etc/passwd', 'root:x:0:0');
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });

    await expect(extractFromZip(buffer, 'test-repo')).rejects.toThrow(IngestionError);
  });

  it('normalizes Windows archive separators before import and route resolution', async () => {
    const zip = new JSZip();
    zip.file('package.json', '{"name":"windows-archive"}');
    zip.file('src\\app.js', "const router = require('./routes/users');");
    zip.file('src\\routes\\users.js', "router.get('/:id', handler);");
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });

    const result = await extractFromZip(buffer, 'windows-archive');
    expect(result.files.map((file) => file.path).sort()).toEqual([
      'package.json',
      'src/app.js',
      'src/routes/users.js',
    ]);
  });

  it('enforces compressed archive size limit', async () => {
    // Test with a custom low archive limit
    const zip = new JSZip();
    zip.file('main.py', 'print("hello")');
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });

    const customLimits = {
      maxFiles: 100,
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
    const zip = new JSZip();
    zip.file('large.py', 'A'.repeat(5000));
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });

    const customLimits = {
      maxFiles: 100,
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

  it('enforces maximum file count limit', async () => {
    const zip = new JSZip();
    for (let i = 0; i < 10; i++) {
      zip.file(`file_${i}.py`, 'print(1)');
    }
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });

    const customLimits = {
      maxFiles: 5, // 5 files limit
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
    const zip = new JSZip();
    zip.file('small.py', 'print("ok")');
    zip.file('huge.py', 'A'.repeat(5000));
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });

    const customLimits = {
      maxFiles: 100,
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
    const zip = new JSZip();
    zip.file('text.py', 'print(1)');
    zip.file('binary.dat', 'test\0binary\0data');
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });

    const result = await extractFromZip(buffer, 'test-repo');
    expect(result.files.map((f) => f.path)).toContain('text.py');
    expect(result.files.map((f) => f.path)).not.toContain('binary.dat');
  });
});
