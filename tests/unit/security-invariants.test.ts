import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { extractFromZip, fetchGitHubRepo } from '../../app/lib/analyzer/ingestion';
import { IngestionError } from '../../app/lib/analyzer/types';
import { PythonSyntaxParser } from '../../app/lib/analyzer/parser/python';

describe('Critical Security Invariants', () => {
  it('does NOT use ambient server GITHUB_TOKEN for unauthenticated requests', async () => {
    // Set ambient server token in environment
    const originalToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'ghp_super_secret_powerful_server_pat_12345';

    let capturedHeaders: Record<string, string> | undefined;
    const originalFetch = global.fetch;

    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      capturedHeaders = (init?.headers as Record<string, string>) || {};
      return Promise.resolve(new Response(new ArrayBuffer(10), { status: 200 }));
    });

    try {
      // Calling fetchGitHubRepo without explicit accessToken
      await fetchGitHubRepo('owner/repo').catch(() => {});

      // Verify that Authorization header was NOT sent
      expect(capturedHeaders?.Authorization).toBeUndefined();
    } finally {
      global.fetch = originalFetch;
      if (originalToken) {
        process.env.GITHUB_TOKEN = originalToken;
      } else {
        delete process.env.GITHUB_TOKEN;
      }
    }
  });

  it('rejects archive entries containing null-byte poison characters', async () => {
    const zip = new JSZip();
    zip.file('file\0.py', 'print("malicious")');
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });

    await expect(extractFromZip(buffer, 'test-repo')).rejects.toThrow(IngestionError);
    await expect(extractFromZip(buffer, 'test-repo')).rejects.toMatchObject({
      code: 'PATH_TRAVERSAL',
      status: 400,
    });
  });

  it('skips excessively deep directory path trees (>32 depth)', async () => {
    const zip = new JSZip();
    const deepPath = Array(35).fill('deep').join('/') + '/nested.py';
    zip.file(deepPath, 'print("deep")');
    zip.file('valid.py', 'print("valid")');
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });

    const result = await extractFromZip(buffer, 'test-repo');
    expect(result.files.map((f) => f.path)).toEqual(['valid.py']);
    expect(result.skipped.some((s) => s.reason === 'path_too_deep')).toBe(true);
  });

  it('Tree-sitter parser safely bounds execution on pathological syntax depth', async () => {
    const parser = new PythonSyntaxParser();

    // Create heavily nested function/class blocks
    let pathologicalCode = 'def f0():\n';
    for (let i = 1; i < 200; i++) {
      pathologicalCode += `${'  '.repeat(i)}def f${i}():\n`;
    }
    pathologicalCode += `${'  '.repeat(200)}pass\n`;

    const parsed = await parser.parse({ source: pathologicalCode });
    expect(parsed.facts).toBeDefined();
    expect(parsed.facts.language).toBe('python');
    // Parser must complete and bound traversal without call stack overflow
    expect(parsed.facts.symbols.length).toBeGreaterThan(0);
    expect(parsed.facts.symbols.length).toBeLessThan(1000);
  });
});
