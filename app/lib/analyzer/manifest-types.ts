export const DEPENDENCY_SCOPES = ['runtime', 'development', 'optional', 'peer', 'build', 'unspecified'] as const;
export type DependencyScope = typeof DEPENDENCY_SCOPES[number];
export type ManifestEcosystem = 'npm' | 'python' | 'go';
export interface ManifestPackage {
  ecosystem: ManifestEcosystem;
  root: string;
  name: string | null;
  workspace: boolean;
  manifests: string[];
}
export interface DependencyDeclaration {
  ecosystem: ManifestEcosystem;
  root: string;
  name: string;
  scope: DependencyScope;
  group: string;
  file: string;
}
export interface ManifestProblem { file: string; code: string; message: string }
export interface ManifestInventory {
  status: 'complete' | 'partial' | 'unavailable';
  packages: ManifestPackage[];
  declarations: DependencyDeclaration[];
  problems: ManifestProblem[];
}
export interface ManifestSink {
  package: (file: string, ecosystem: ManifestEcosystem, name: string | null, workspace?: boolean) => void;
  dependency: (file: string, ecosystem: ManifestEcosystem, name: string, scope: DependencyScope, group: string) => void;
  problem: (file: string, code: string, message: string) => void;
}
export const unavailableManifests = (): ManifestInventory => ({ status: 'unavailable', packages: [], declarations: [], problems: [] });
export function manifestCounts(inventory: ManifestInventory) {
  const all = new Set<string>();
  const scopes = Object.fromEntries(DEPENDENCY_SCOPES.map((scope) => [scope, new Set<string>()])) as Record<DependencyScope, Set<string>>;
  for (const row of inventory.declarations) {
    const id = JSON.stringify([row.ecosystem, row.root, row.name]);
    all.add(id);
    scopes[row.scope].add(id);
  }
  const known = inventory.status !== 'unavailable';
  return {
    packages: known ? inventory.packages.length : null,
    dependencies: known ? all.size : null,
    scopes: Object.fromEntries(DEPENDENCY_SCOPES.map((scope) => [scope, known ? scopes[scope].size : null])) as Record<DependencyScope, number | null>,
  };
}
