import { afterEach, expect, it, vi } from 'vitest';
import { makeV2Fixture } from './export/fixtures';
import { loadRepoDNAArtifact, adaptV1ToV2Viewer } from '../../app/lib/schema/artifact-loader';
import { validateRepoDNAProjectV2 } from '../../app/lib/schema/safe-validator';
import { classifySourcePaths } from '../../app/lib/analyzer/source-inventory';
import { unavailableManifests } from '../../app/lib/analyzer/manifest-types';
import { readFileSync } from 'node:fs';
import type { RepoDNAProject } from '../../app/lib/types';

const globals = globalThis as typeof globalThis & { __repodnaAjvV2?: unknown };
afterEach(() => { delete globals.__repodnaAjvV2; vi.unstubAllGlobals(); });
for (const browser of [false, true]) {
  it(`validates reconciled evidence and rejects contradictions (${browser ? 'CSP' : 'Ajv'})`, () => {
    delete globals.__repodnaAjvV2;
    if (browser) vi.stubGlobal('window', {});
    const project = makeV2Fixture();
    project.inventory.manifestInventory = unavailableManifests();
    project.inventory.sourceInventory = classifySourcePaths(['src/a.py', 'src/b.py']);
    project.inventory.sourceOutcomes = { supported: 2, complete: 1, partial: 1, failed: 0, skipped: 0, unprocessed: 0 };
    expect(validateRepoDNAProjectV2(project).errors).toEqual([]);
    project.inventory.sourceOutcomes.complete = 2;
    expect(validateRepoDNAProjectV2(project).valid).toBe(false);
    project.inventory.sourceOutcomes.complete = 1;
    project.inventory.sourceInventory.otherFileCount = 1;
    expect(validateRepoDNAProjectV2(project).valid).toBe(false);
    project.inventory.sourceInventory.otherFileCount = 0;
    Object.assign(project.inventory.manifestInventory, { unexpected: 'field' });
    expect(validateRepoDNAProjectV2(project).valid).toBe(false);
  });
}
it('does not turn legacy language/import proxies into manifest counts or mutate imports', () => {
  const original = makeV2Fixture();
  original.inventory.packageCount = 30;
  original.inventory.declaredDependencyCount = 999;
  const loaded = loadRepoDNAArtifact(original).project;
  expect('inventory' in loaded && loaded.inventory).toMatchObject({ packageCount: null, declaredDependencyCount: null, manifestInventory: { status: 'unavailable' } });
  expect(original.inventory.packageCount).toBe(30);
  const legacy = JSON.parse(readFileSync('public/demo-project.json', 'utf8')) as RepoDNAProject;
  const adapted = adaptV1ToV2Viewer(legacy);
  expect(adapted.inventory.packageCount).toBeNull();
  expect(adapted.inventory.declaredDependencyCount).toBeNull();
});
