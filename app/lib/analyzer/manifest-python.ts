import { parse } from 'smol-toml';
import { objectValue } from './manifest-json';
import type { DependencyScope, ManifestSink } from './manifest-types';

export function pythonDependencyName(value: string): string | null {
  const match = value.match(/^\s*([a-z0-9][a-z0-9._-]*)(?=\s*(?:\[|[<>=!~;@]|$))/i);
  return match ? match[1].toLowerCase().replace(/[-_.]+/g, '-') : null;
}
export function groupScope(group: string): DependencyScope {
  return /^(dev|development|test|tests|testing|lint|docs|doc|typing|typecheck)$/i.test(group) ? 'development' : 'unspecified';
}
export function readPythonToml(file: string, content: string, sink: ManifestSink): void {
  const data = parse(content, { unsafeKeyBehaviour: 'throw' });
  const add = (value: unknown, scope: DependencyScope, group: string) => {
    const name = typeof value === 'string' ? pythonDependencyName(value) : null;
    if (name) sink.dependency(file, 'python', name, scope, group);
    else sink.problem(file, 'MANIFEST_PARSE_FAILED', 'A Python requirement could not be read as a named declaration.');
  };
  const array = (value: unknown, scope: DependencyScope, group: string) => {
    if (value === undefined) return;
    if (Array.isArray(value)) for (const item of value) add(item, scope, group);
    else sink.problem(file, 'MANIFEST_PARSE_FAILED', 'Expected a Python dependency array.');
  };
  const table = (value: unknown, scope: DependencyScope, group: string) => {
    if (value === undefined) return;
    if (!value || typeof value !== 'object' || Array.isArray(value)) { sink.problem(file, 'MANIFEST_PARSE_FAILED', 'Expected a Python dependency table.'); return; }
    for (const [name, specifier] of Object.entries(value)) {
      if (name === 'python') continue; // interpreter constraint, not a distribution
      if (typeof specifier !== 'string' && (!specifier || typeof specifier !== 'object' || Array.isArray(specifier))) { sink.problem(file, 'MANIFEST_PARSE_FAILED', 'Unsupported Python dependency value.'); continue; }
      sink.dependency(file, 'python', name, objectValue(specifier).optional === true ? 'optional' : scope, group);
    }
  };
  if (file.split('/').pop() === 'Pipfile') {
    sink.package(file, 'python', null);
    table(data.packages, 'runtime', 'packages');
    table(data['dev-packages'], 'development', 'dev-packages');
    return;
  }
  const project = objectValue(data.project);
  const poetry = objectValue(objectValue(data.tool).poetry);
  if (typeof project.name === 'string' || Object.keys(poetry).length) sink.package(file, 'python', typeof project.name === 'string' ? project.name : typeof poetry.name === 'string' ? poetry.name : null);
  array(project.dependencies, 'runtime', 'project.dependencies');
  for (const [group, values] of Object.entries(objectValue(project['optional-dependencies']))) array(values, 'optional', `project.optional-dependencies.${group}`);
  array(objectValue(data['build-system']).requires, 'build', 'build-system.requires');
  if (Array.isArray(project.dynamic) && project.dynamic.some((item) => item === 'dependencies' || item === 'optional-dependencies')) sink.problem(file, 'MANIFEST_DYNAMIC_UNRESOLVED', 'Dynamic dependency declarations require package-build execution and were not evaluated.');
  table(poetry.dependencies, 'runtime', 'tool.poetry.dependencies');
  table(poetry['dev-dependencies'], 'development', 'tool.poetry.dev-dependencies');
  for (const [group, value] of Object.entries(objectValue(poetry.group))) table(objectValue(value).dependencies, groupScope(group), `tool.poetry.group.${group}.dependencies`);
  const groups = objectValue(data['dependency-groups']);
  const expand = (name: string, chain: string[], owner: string): void => {
    if (chain.includes(name) || chain.length >= 16) { sink.problem(file, 'MANIFEST_DYNAMIC_UNRESOLVED', 'Dependency-group include is cyclic or exceeds depth 16.'); return; }
    const values = groups[name];
    if (!Array.isArray(values)) { sink.problem(file, 'MANIFEST_PARSE_FAILED', 'A dependency group or included group is missing or invalid.'); return; }
    for (const value of values) {
      if (typeof value === 'string') add(value, groupScope(owner), `dependency-groups.${owner}`);
      else if (typeof objectValue(value)['include-group'] === 'string') expand(objectValue(value)['include-group'] as string, [...chain, name], owner);
      else sink.problem(file, 'MANIFEST_PARSE_FAILED', 'A dependency-group entry has an unsupported value.');
    }
  };
  for (const name of Object.keys(groups)) expand(name, [], name);
}
