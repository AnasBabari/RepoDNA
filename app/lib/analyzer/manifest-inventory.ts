import type { DiscoveredFile } from './types';
import type { ManifestInventory, ManifestSink } from './manifest-types';
import { readPackageJson } from './manifest-json';
import { readPythonToml } from './manifest-python';
import { readGoMod, readRequirements, readSetupCfg } from './manifest-text';
import { isIgnored, isGeneratedPath } from './source-policy';

export const MANIFEST_LIMITS = { files: 2000, declarations: 50000, visits: 100000, bytes: 1000000, expandedBytes: 32 * 1024 * 1024 } as const;
class ManifestBudgetReached extends Error {}
export function isRequirementsManifest(path: string): boolean {
  return /^requirements(?:[._-][\w.-]+)?\.txt$/i.test(path.split('/').pop() ?? '') || (path.split('/').includes('requirements') && path.endsWith('.txt'));
}
export function isManifestPath(path: string): boolean {
  return isRequirementsManifest(path) || /(?:^|\/)(?:package\.json|pyproject\.toml|Pipfile|setup\.cfg|setup\.py|go\.mod|Cargo\.toml|pom\.xml|build\.gradle)$/.test(path);
}
export function collectManifestInventory(files: DiscoveredFile[], skipped: { path: string; reason: string }[] = []): ManifestInventory {
  const inventory: ManifestInventory = { status: 'complete', packages: [], declarations: [], problems: [] };
  const packages = new Map<string, ManifestInventory['packages'][number]>();
  const declarations = new Map<string, ManifestInventory['declarations'][number]>();
  const issues = new Set<string>();
  const root = (file: string) => file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.';
  let visits = 0;
  let expandedBytes = 0;
  const sink: ManifestSink = {
    step(_file, bytes = 0) { expandedBytes += bytes; if (++visits > MANIFEST_LIMITS.visits || expandedBytes > MANIFEST_LIMITS.expandedBytes || bytes > MANIFEST_LIMITS.bytes) throw new ManifestBudgetReached(); },
    package(file, ecosystem, name, workspace = false) {
      if (name && name.length > 512) { sink.problem(file, 'MANIFEST_PARSE_FAILED', 'Package name exceeds the metadata bound.'); name = null; }
      const key = JSON.stringify([ecosystem, root(file)]);
      const old = packages.get(key);
      packages.set(key, { ecosystem, root: root(file), name: name || old?.name || null, workspace: workspace || old?.workspace || false, manifests: [...new Set([...(old?.manifests ?? []), file])].sort() });
    },
    dependency(file, ecosystem, name, scope, group) {
      sink.step(file);
      if (declarations.size >= MANIFEST_LIMITS.declarations) throw new ManifestBudgetReached();
      if (group.length > 1024 || file.length > 4096) { sink.problem(file.slice(0, 4096), 'MANIFEST_INVENTORY_LIMIT_REACHED', 'Manifest provenance exceeds the metadata length bound.'); return; }
      const normalized = ecosystem === 'python' ? name.toLowerCase().replace(/[-_.]+/g, '-') : ecosystem === 'npm' ? name.toLowerCase() : name;
      const allowed = ecosystem === 'npm' ? /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/ : ecosystem === 'go' ? /^[a-zA-Z0-9._~!/-]+$/ : /^[a-z0-9][a-z0-9-]*$/;
      if (normalized.length > 512 || !allowed.test(normalized)) { sink.problem(file, 'MANIFEST_PARSE_FAILED', 'A dependency name could not be represented safely.'); return; }
      const row = { ecosystem, root: root(file), name: normalized, scope, group, file };
      declarations.set(JSON.stringify(row), row); // Never retain version/URL values that may contain credentials.
    },
    problem(file, code, message) {
      inventory.status = 'partial';
      const key = JSON.stringify([file, code, message]);
      if (!issues.has(key) && inventory.problems.length < MANIFEST_LIMITS.files) { issues.add(key); inventory.problems.push({ file, code, message }); }
    },
  };
  const candidates = files.filter((file) => !isIgnored(file.path) && !isGeneratedPath(file.path) && isManifestPath(file.path)).sort((a, b) => a.path.localeCompare(b.path));
  const textByPath = new Map(files.map((file) => [file.path, file.content]));
  if (candidates.length > MANIFEST_LIMITS.files) sink.problem('*', 'MANIFEST_INVENTORY_LIMIT_REACHED', 'Manifest count exceeded 2000; counts are lower bounds.');
  for (const file of candidates.slice(0, MANIFEST_LIMITS.files)) {
    const name = file.path.split('/').pop();
    try {
      if (new TextEncoder().encode(file.content).byteLength > MANIFEST_LIMITS.bytes) { sink.problem(file.path, 'MANIFEST_INVENTORY_LIMIT_REACHED', 'Manifest exceeds the 1 MB parsing bound.'); continue; }
      sink.step(file.path, isRequirementsManifest(file.path) ? 0 : new TextEncoder().encode(file.content).byteLength);
      if (name === 'package.json') readPackageJson(file.path, file.content, sink);
      else if (name === 'pyproject.toml' || name === 'Pipfile') readPythonToml(file.path, file.content, sink);
      else if (isRequirementsManifest(file.path)) readRequirements(file.path, textByPath, sink);
      else if (name === 'setup.cfg') readSetupCfg(file.path, file.content, sink);
      else if (name === 'go.mod') readGoMod(file.path, file.content, sink);
      else if (name === 'setup.py') { sink.package(file.path, 'python', null); sink.problem(file.path, 'MANIFEST_DYNAMIC_UNRESOLVED', 'setup.py dependency metadata is executable and was not evaluated.'); }
      else sink.problem(file.path, 'MANIFEST_FORMAT_UNSUPPORTED', 'This package manifest format is not supported; counts are lower bounds.');
    } catch (error) {
      if (error instanceof ManifestBudgetReached) { sink.problem(file.path, 'MANIFEST_INVENTORY_LIMIT_REACHED', 'Manifest declaration/expansion budget reached; counts are lower bounds.'); break; }
      sink.problem(file.path, 'MANIFEST_PARSE_FAILED', 'Manifest could not be parsed as static data; no code was run.');
    }
  }
  for (const item of skipped) if (item.path === '*' || isManifestPath(item.path)) sink.problem(item.path, 'MANIFEST_ACQUISITION_INCOMPLETE', 'A package manifest may not have been acquired; counts are lower bounds.');
  inventory.packages = [...packages.values()].sort((a, b) => a.root.localeCompare(b.root) || a.ecosystem.localeCompare(b.ecosystem));
  inventory.declarations = [...declarations.values()].map((row) => {
    let candidate = row.root;
    while (candidate !== '.' && !packages.has(JSON.stringify([row.ecosystem, candidate]))) candidate = root(candidate);
    const owner = packages.get(JSON.stringify([row.ecosystem, candidate]));
    return { ...row, root: owner?.root ?? row.root };
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  inventory.problems.sort((a, b) => a.file.localeCompare(b.file) || a.code.localeCompare(b.code));
  return inventory;
}
