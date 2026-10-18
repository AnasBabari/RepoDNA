import { expect, it } from 'vitest';
import { collectManifestInventory, MANIFEST_LIMITS } from '../../app/lib/analyzer/manifest-inventory';
import { manifestCounts } from '../../app/lib/analyzer/manifest-types';

const file = (path: string, content: string) => ({ path, content, hash: path, size: content.length });
it('reads setup.cfg, Pipfile, and Go scopes without treating interpreter constraints as packages', () => {
  const inventory = collectManifestInventory([
    file('py/setup.cfg', '[metadata]\nname = service\n[options]\ninstall_requires =\n  requests>=2\n[options.extras_require]\ntest =\n  pytest\n'),
    file('py/Pipfile', '[packages]\npython="3.12"\nrequests="*"\n[dev-packages]\nruff="*"\n'),
    file('go/go.mod', 'module example.test/service // comment\nrequire (\n github.com/a/pkg v1.2.3\n example.test/b v2.0.0 // indirect\n)\n'),
  ]);
  expect(inventory.status).toBe('complete');
  expect(manifestCounts(inventory)).toMatchObject({ packages: 2, dependencies: 5, scopes: { runtime: 3, development: 1, optional: 1 } });
  expect(inventory.declarations).toContainEqual(expect.objectContaining({ name: 'example.test/b', group: 'require.indirect', file: 'go/go.mod' }));
});
it('reports malformed types, prototype keys, cycles, and external includes without source leakage', () => {
  const cases = [file('package.json', '[]'), file('pyproject.toml', 'project="invalid"'), file('pyproject.toml', '__proto__={secret="DO_NOT_EXPOSE"}'), file('pyproject.toml', '[dependency-groups]\ndev=[{include-group="dev"}]'), file('requirements.txt', '-r requirements.txt\n-r ../outside.txt\n-r https://user:DO_NOT_EXPOSE@example.test/a.txt')];
  for (const input of cases) {
    const inventory = collectManifestInventory([input]);
    expect(inventory.status).toBe('partial');
    expect(JSON.stringify(inventory)).not.toContain('DO_NOT_EXPOSE');
  }
});
it('bounds manifest bytes, file count, declaration count and recursive expansion', () => {
  const oversized = collectManifestInventory([file('package.json', ' '.repeat(MANIFEST_LIMITS.bytes + 1))]);
  expect(oversized.problems[0].code).toBe('MANIFEST_INVENTORY_LIMIT_REACHED');
  const many = collectManifestInventory(Array.from({ length: MANIFEST_LIMITS.files + 1 }, (_, n) => file(`p${n}/package.json`, '{}')));
  expect(many.packages).toHaveLength(MANIFEST_LIMITS.files);
  expect(many.status).toBe('partial');
  const dependencies = Object.fromEntries(Array.from({ length: MANIFEST_LIMITS.declarations + 1 }, (_, n) => [`p${n}`, '*']));
  const limited = collectManifestInventory([file('package.json', JSON.stringify({ dependencies }))]);
  expect(limited.declarations).toHaveLength(MANIFEST_LIMITS.declarations);
  expect(limited.status).toBe('partial');
  const groups = Array.from({ length: 16 }, (_, n) => `g${n}=[{include-group="g${n + 1}"},{include-group="g${n + 1}"}]`).join('\n');
  const expanded = collectManifestInventory([file('pyproject.toml', `[dependency-groups]\n${groups}\ng16=[]`)]);
  expect(expanded.problems.some((problem) => problem.code === 'MANIFEST_INVENTORY_LIMIT_REACHED')).toBe(true);
});
it('bounds repeated include bytes even when declarations are deduplicated', () => {
  const inventory = collectManifestInventory([file('requirements.txt', '-r requirements/base.txt\n'.repeat(100)), file('requirements/base.txt', `# ${'x'.repeat(500000)}\nrequests # comment`)]);
  expect(inventory.status).toBe('partial');
  expect(inventory.problems.some((item) => item.code === 'MANIFEST_INVENTORY_LIMIT_REACHED')).toBe(true);
  expect(manifestCounts(inventory).dependencies).toBe(1);
});
