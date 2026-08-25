import { describe, expect, it } from 'vitest';
import { analyzeJavaScript } from '../../app/lib/analyzer/analyzers/javascript';
import { isTestFile } from '../../app/lib/analyzer/detection';
import type { DiscoveredFile } from '../../app/lib/analyzer/types';

function jsFile(path: string, source: string): DiscoveredFile {
  return { path, size: source.length, content: source, hash: 'test-hash' };
}

describe('isTestFile', () => {
  it.each([
    ['auth_test.go', true],
    ['internal/router/router_test.go', true],
    ['tests/test_users.py', true],
    ['users_test.py', true],
    ['conftest.py', true],
    ['src/api.test.ts', true],
    ['src/api.spec.tsx', true],
    ['src/__tests__/api.js', true],
  ])('classifies %s as test fixture', (path, expected) => {
    expect(isTestFile(path)).toBe(expected);
  });

  it.each([
    ['main.go'],
    ['api/routes.go'],
    ['attest.go'], // contains _test substring but not suffix
    ['src/contest.py'],
    ['latest.ts'],
  ])('does not misclassify %s', (path) => {
    expect(isTestFile(path)).toBe(false);
  });
});

describe('route extraction skips test fixtures', () => {
  const mockServer = `
const express = require('express');
const app = express();
app.get('/login', handler);
function handler(req, res) { res.send('ok'); }
`;

  it('extracts no routes from a Go-style test file via JS analyzer path', () => {
    // The JS analyzer itself should also skip *.test.ts fixtures
    const result = analyzeJavaScript(jsFile('server.test.ts', mockServer));
    expect(result.routes).toHaveLength(0);
  });

  it('still extracts routes from production files', () => {
    const result = analyzeJavaScript(jsFile('server.ts', mockServer));
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].path).toBe('/login');
  });
});
