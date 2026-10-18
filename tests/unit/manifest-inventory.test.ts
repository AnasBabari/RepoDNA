import { expect, it } from 'vitest';
import { collectManifestInventory } from '../../app/lib/analyzer/manifest-inventory';
import { manifestCounts } from '../../app/lib/analyzer/manifest-types';

const file = (path: string, content: string) => ({ path, content, hash: path, size: content.length });
it('counts package roots and scoped declarations, not languages or repeated imports', () => {
  const inventory = collectManifestInventory([
    file('package.json', JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'], dependencies: { shared: '^1' }, devDependencies: { shared: '^1', vitest: '*' } })),
    file('packages/a/package.json', JSON.stringify({ name: 'a', dependencies: { shared: '^1', '@scope/pkg': '*' }, peerDependencies: { react: '^19' } })),
    file('packages/a/main.ts', 'import shared from "shared";\n'.repeat(200)),
    file('node_modules/vendor/package.json', JSON.stringify({ dependencies: { transitive: '*' } })),
  ]);
  expect(inventory.status).toBe('complete');
  expect(inventory.packages.map((pkg) => pkg.root)).toEqual(['.', 'packages/a']);
  expect(inventory.packages[0].workspace).toBe(true);
  expect(manifestCounts(inventory)).toMatchObject({ packages: 2, dependencies: 5, scopes: { runtime: 3, development: 2, peer: 1 } });
  expect(inventory.declarations.some((row) => row.name === 'transitive')).toBe(false);
});
it('reads TOML arrays/tables and distinguishes runtime, optional, build and dev groups', () => {
  const inventory = collectManifestInventory([file('pyproject.toml', `
[project]
name = "requests-like"
dependencies = ["urllib3>=1", "charset_normalizer>=2"]
[project.optional-dependencies]
security = ["cryptography"]
[build-system]
requires = ["setuptools"]
[dependency-groups]
shared = ["pytest"]
dev = [{include-group="shared"}, "ruff"]
`), file('requirements/base.txt', 'urllib3==2\n-r test.txt'), file('requirements/test.txt', 'pytest\n')]);
  expect(inventory.status).toBe('complete');
  expect(manifestCounts(inventory)).toMatchObject({ packages: 1, dependencies: 6, scopes: { runtime: 2, optional: 1, build: 1, development: 2 } });
  expect(inventory.declarations.every((row) => row.root === '.')).toBe(true);
  expect(inventory.declarations.some((row) => row.name === 'charset-normalizer')).toBe(true);
});
it('marks malformed, dynamic, unsupported and missing evidence partial without running it', () => {
  const inventory = collectManifestInventory([file('package.json', '{broken'), file('setup.py', 'raise RuntimeError("must not execute")'), file('Cargo.toml', '[package]\nname="x"')], [{ path: 'missing/pyproject.toml', reason: 'max_files_limit' }]);
  expect(inventory.status).toBe('partial');
  expect(inventory.problems.map((problem) => problem.code)).toEqual(expect.arrayContaining(['MANIFEST_PARSE_FAILED', 'MANIFEST_DYNAMIC_UNRESOLVED', 'MANIFEST_FORMAT_UNSUPPORTED', 'MANIFEST_ACQUISITION_INCOMPLETE']));
  expect(inventory.problems.map((problem) => problem.message).join(' ')).not.toContain('must not execute');
});
it('does not retain credential-bearing dependency versions or index URLs', () => {
  const inventory = collectManifestInventory([file('package.json', JSON.stringify({ dependencies: { valid: 'https://user:TOP_SECRET@example.test/a.tgz' } })), file('requirements.txt', '--index-url https://user:TOP_SECRET@example.test\nrequests @ https://user:TOP_SECRET@example.test/a.whl')]);
  expect(manifestCounts(inventory).dependencies).toBe(2);
  expect(JSON.stringify(inventory)).not.toContain('TOP_SECRET');
});
