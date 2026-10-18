import { expect, it } from 'vitest';
import { isCandidate, isSourcePath, isSupportedSource } from '../../app/lib/analyzer/source-policy';

it('retains extensionless configuration evidence without calling it supported source', () => {
  for (const path of ['Makefile', 'tools/Makefile', 'Dockerfile', 'Procfile', 'Pipfile', 'package.json', 'pyproject.toml']) {
    expect(isCandidate(path), path).toBe(true);
    expect(isSupportedSource(path), path).toBe(false);
    expect(isSourcePath(path), path).toBe(false);
  }
});
it('distinguishes supported, recognized-unsupported and non-source paths', () => {
  expect(isSupportedSource('src/a.py')).toBe(true);
  expect(isSourcePath('src/lib.rs')).toBe(true);
  expect(isSupportedSource('src/lib.rs')).toBe(false);
  for (const path of ['README.md', 'logo.png', 'docs/requirements.md']) expect(isSourcePath(path)).toBe(false);
  expect(isCandidate('requirements-dev.txt')).toBe(true);
  expect(isCandidate('requirements/testing.txt')).toBe(true);
  expect(isCandidate('docs/arbitrary.txt')).toBe(false);
});
