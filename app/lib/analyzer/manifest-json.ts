import type { ManifestSink, DependencyScope } from './manifest-types';

export function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function readPackageJson(file: string, content: string, sink: ManifestSink): void {
  const parsed: unknown = JSON.parse(content);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid package manifest');
  const pkg = objectValue(parsed);
  sink.package(file, 'npm', typeof pkg.name === 'string' ? pkg.name : null, Array.isArray(pkg.workspaces) || Array.isArray(objectValue(pkg.workspaces).packages));
  const fields: [string, DependencyScope][] = [['dependencies', 'runtime'], ['devDependencies', 'development'], ['optionalDependencies', 'optional'], ['peerDependencies', 'peer']];
  for (const [field, scope] of fields) {
    const value = pkg[field];
    if (value === undefined) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      sink.problem(file, 'MANIFEST_PARSE_FAILED', `Expected an object for ${field}.`);
      continue;
    }
    for (const [name, specifier] of Object.entries(value)) {
      if (typeof specifier === 'string') sink.dependency(file, 'npm', name, scope, field);
      else sink.problem(file, 'MANIFEST_PARSE_FAILED', 'A dependency declaration has an unsupported value type.');
    }
  }
  const bundled = pkg.bundledDependencies ?? pkg.bundleDependencies;
  if (Array.isArray(bundled)) for (const name of bundled) {
    if (typeof name === 'string') sink.dependency(file, 'npm', name, 'runtime', 'bundledDependencies');
  }
}
