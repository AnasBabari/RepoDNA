import type { ManifestSink } from './manifest-types';
import { pythonDependencyName } from './manifest-python';

export function readRequirements(file: string, files: Map<string, string>, sink: ManifestSink, chain: string[] = []): void {
  sink.step(file);
  if (chain.includes(file) || chain.length >= 16) { sink.problem(file, 'MANIFEST_DYNAMIC_UNRESOLVED', 'Requirements include is cyclic or exceeds depth 16.'); return; }
  const content = files.get(file);
  if (content === undefined) { sink.problem(file, 'MANIFEST_DYNAMIC_UNRESOLVED', 'A local requirements include was not acquired.'); return; }
  for (const raw of content.replace(/\\\r?\n/g, '').split(/\r?\n/)) {
    const value = raw.trim();
    if (!value || value.startsWith('#')) continue;
    sink.step(file);
    const include = value.match(/^(?:-r\s*|--requirement(?:=|\s+))(.+)$/);
    if (include) {
      const parts = [...file.split('/').slice(0, -1), ...include[1].trim().split('/')];
      const resolved: string[] = [];
      let outside = false;
      for (const part of parts) { if (part === '..') { if (!resolved.length) outside = true; else resolved.pop(); } else if (part && part !== '.') resolved.push(part); }
      if (outside || /^(?:https?:|\/|\\|[a-z]:)/i.test(include[1])) sink.problem(file, 'MANIFEST_DYNAMIC_UNRESOLVED', 'External or out-of-repository requirements includes are not followed.');
      else readRequirements(resolved.join('/'), files, sink, [...chain, file]);
      continue;
    }
    if (/^(?:-c\s|--constraint(?:=|\s)|--index-url|--extra-index-url|--find-links|--trusted-host|--no-index)/.test(value)) continue; // constraints/indexes are not dependency declarations
    const name = pythonDependencyName(value) ?? value.match(/[#&]egg=([a-z0-9._-]+)/i)?.[1];
    if (name) sink.dependency(file, 'python', name, 'unspecified', 'requirements');
    else sink.problem(file, 'MANIFEST_DYNAMIC_UNRESOLVED', 'A requirements entry is not a statically named dependency.');
  }
}
export function readSetupCfg(file: string, content: string, sink: ManifestSink): void {
  let section = '';
  let field = '';
  sink.package(file, 'python', null);
  for (const raw of content.split(/\r?\n/)) {
    const value = raw.trim();
    if (!value || /^[#;]/.test(value)) continue;
    if (/^\[.*\]$/.test(value)) { section = value.slice(1, -1); field = ''; continue; }
    const assignment = value.match(/^([\w.-]+)\s*=\s*(.*)$/);
    if (assignment && !/^\s/.test(raw)) {
      field = assignment[1];
      if (section === 'metadata' && field === 'name') sink.package(file, 'python', assignment[2]);
    }
    const requirement = assignment && !/^\s/.test(raw) ? assignment[2] : value;
    if (!requirement || !((section === 'options' && field === 'install_requires') || section === 'options.extras_require')) continue;
    const name = pythonDependencyName(requirement);
    if (name) sink.dependency(file, 'python', name, section === 'options' ? 'runtime' : 'optional', `${section}.${field}`);
    else sink.problem(file, 'MANIFEST_DYNAMIC_UNRESOLVED', 'A setup.cfg dependency could not be read statically.');
  }
}
export function readGoMod(file: string, content: string, sink: ManifestSink): void {
  const module = content.match(/^\s*module\s+([^\s]+)\s*$/m);
  sink.package(file, 'go', module ? module[1].replace(/^"|"$/g, '') : null);
  if (!module) sink.problem(file, 'MANIFEST_PARSE_FAILED', 'The go.mod module directive is missing or unsupported.');
  let block = false;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^require\s*\(/.test(line)) { block = true; continue; }
    if (line === ')') { block = false; continue; }
    const match = (block ? line : line.replace(/^require\s+/, '')).match(/^([^\s]+)\s+v\d[^\s]*(?:\s|$)/);
    if (match && (block || /^require\s+/.test(line))) sink.dependency(file, 'go', match[1], 'runtime', /\/\/\s*indirect/.test(line) ? 'require.indirect' : 'require');
  }
}
