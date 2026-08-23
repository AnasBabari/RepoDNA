import { describe, expect, it } from 'vitest';
import { parseGitHubUrl } from '../../app/lib/analyzer/ingestion';

describe('Reliability Smoke Tests', () => {
  const urlMatrix = [
    { input: 'https://github.com/AnasBabari/RepoDNA', expected: 'https://github.com/AnasBabari/RepoDNA', owner: 'AnasBabari', repo: 'RepoDNA' },
    { input: 'github.com/AnasBabari/RepoDNA', expected: 'https://github.com/AnasBabari/RepoDNA', owner: 'AnasBabari', repo: 'RepoDNA' },
    { input: 'www.github.com/AnasBabari/RepoDNA', expected: 'https://github.com/AnasBabari/RepoDNA', owner: 'AnasBabari', repo: 'RepoDNA' },
    { input: 'https://github.com/AnasBabari/RepoDNA?tab=readme-ov-file', expected: 'https://github.com/AnasBabari/RepoDNA', owner: 'AnasBabari', repo: 'RepoDNA' },
    { input: 'https://github.com/AnasBabari/RepoDNA#readme', expected: 'https://github.com/AnasBabari/RepoDNA', owner: 'AnasBabari', repo: 'RepoDNA' },
    { input: 'https://github.com/AnasBabari/RepoDNA/tree/main', expected: 'https://github.com/AnasBabari/RepoDNA', owner: 'AnasBabari', repo: 'RepoDNA' },
    { input: 'https://github.com/AnasBabari/RepoDNA/blob/main/README.md', expected: 'https://github.com/AnasBabari/RepoDNA', owner: 'AnasBabari', repo: 'RepoDNA' },
    { input: 'git@github.com:AnasBabari/RepoDNA.git', expected: 'https://github.com/AnasBabari/RepoDNA', owner: 'AnasBabari', repo: 'RepoDNA' },
    { input: 'ssh://git@github.com/AnasBabari/RepoDNA.git', expected: 'https://github.com/AnasBabari/RepoDNA', owner: 'AnasBabari', repo: 'RepoDNA' },
    { input: 'AnasBabari/RepoDNA', expected: 'https://github.com/AnasBabari/RepoDNA', owner: 'AnasBabari', repo: 'RepoDNA' },
    { input: '@AnasBabari/RepoDNA', expected: 'https://github.com/AnasBabari/RepoDNA', owner: 'AnasBabari', repo: 'RepoDNA' },
  ];

  it('correctly canonicalizes the entire supported URL matrix to repo roots', () => {
    for (const testCase of urlMatrix) {
      const parsed = parseGitHubUrl(testCase.input);
      expect(parsed, `Failed on input: ${testCase.input}`).not.toBeNull();
      expect(parsed?.owner).toBe(testCase.owner);
      expect(parsed?.repo).toBe(testCase.repo);
      expect(parsed?.canonicalUrl).toBe(testCase.expected);
    }
  });

  it('strictly rejects non-GitHub and hostile inputs', () => {
    const hostileInputs = [
      'https://gitlab.com/AnasBabari/RepoDNA',
      'https://attacker.github.com.evil.com/AnasBabari/RepoDNA',
      'https://github.com.evil.com/AnasBabari/RepoDNA',
      'http://169.254.169.254/AnasBabari/RepoDNA',
      'http://localhost:3000/AnasBabari/RepoDNA',
      'https://user:password@github.com/AnasBabari/RepoDNA',
      'ftp://github.com/AnasBabari/RepoDNA',
      'https://github.com/',
      'https://github.com/settings',
      'https://github.com/explore',
    ];

    for (const hostile of hostileInputs) {
      const parsed = parseGitHubUrl(hostile);
      expect(parsed, `Should reject hostile URL: ${hostile}`).toBeNull();
    }
  });

  it('guarantees sanitized diagnostics never expose sensitive information', () => {
    const rawError = {
      code: 'UPSTREAM_GITHUB_ERROR',
      message: 'Failed to fetch https://x-access-token:ghp_123456789@github.com/SecretOrg/SecretProject',
      requestId: 'req_test123',
    };

    const sanitizedDiagnostic = {
      stage: 'Fetching Repository',
      errorCode: rawError.code,
      requestId: rawError.requestId,
      analysisMode: 'server',
      appVersion: 'v1.1.0-a91b35f',
      timestamp: new Date().toISOString(),
      fallbackAvailable: true,
    };

    const serialized = JSON.stringify(sanitizedDiagnostic);
    expect(serialized).not.toContain('ghp_');
    expect(serialized).not.toContain('SecretOrg');
    expect(serialized).not.toContain('SecretProject');
    expect(serialized).not.toContain('x-access-token');
    expect(sanitizedDiagnostic.errorCode).toBe('UPSTREAM_GITHUB_ERROR');
    expect(sanitizedDiagnostic.requestId).toBe('req_test123');
  });
});
