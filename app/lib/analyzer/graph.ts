import type {
  ArchitectureComponent,
  ArchitectureConnection,
  CallRecord,
  EntrypointRecord,
  FileRecord,
  FlowRecord,
  ImportRecord,
  PartialAnalysis,
  RouteRecord,
  SymbolRecord,
} from './types';
import { filterMeaningfulDependencyCycles } from './cycles';

export const COMPONENT_NAMES: Record<string, string> = {
  frontend: 'Frontend',
  api: 'API layer',
  services: 'Services',
  domain: 'Domain',
  repositories: 'Repositories',
  database: 'Database',
  workers: 'Background workers',
  infrastructure: 'Infrastructure',
  tests: 'Tests',
  configuration: 'Configuration',
  other: 'Application core',
};

export const COMPONENT_ORDER = [
  'frontend', 'api', 'services', 'domain', 'repositories', 'database',
  'workers', 'infrastructure', 'configuration', 'tests', 'other',
];

function normalizePath(parts: string[]): string {
  const result: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (result.length > 0) result.pop();
      continue;
    }
    result.push(part);
  }
  return result.join('/');
}

function detectPackageRoots(available: Set<string>): string[] {
  const roots = new Set<string>();
  for (const path of available) {
    const parts = path.split('/');
    if (parts[parts.length - 1] === '__init__.py' && parts.length > 1) {
      roots.add(parts[0]);
      if (parts.length > 2 && ['src', 'lib', 'packages'].includes(parts[0])) {
        roots.add(`${parts[0]}/${parts[1]}`);
      }
    } else if (parts.length > 0 && ['src', 'lib'].includes(parts[0])) {
      roots.add(parts[0]);
    }
  }
  return Array.from(roots).sort((a, b) => b.split('/').length - a.split('/').length);
}

function resolvePythonImport(edge: ImportRecord, available: Set<string>, packageRoots: string[]): string | null {
  const sourceParts = edge.source.split('/');
  sourceParts.pop();
  const moduleName = edge.module;
  const leadingDots = moduleName.length - moduleName.replace(/^\.+/, '').length;
  const cleanModule = moduleName.replace(/^\.+/, '');
  const moduleParts = cleanModule ? cleanModule.split('.') : [];

  if (leadingDots > 0) {
    const baseParts = [...sourceParts];
    for (let i = 0; i < Math.max(0, leadingDots - 1); i++) {
      if (baseParts.length > 0) baseParts.pop();
    }
    const stemParts = [...baseParts, ...moduleParts];
    const norm = normalizePath(stemParts);
    const candidates = [
      `${norm}.py`,
      `${norm}/__init__.py`,
      `${norm}.pyi`,
    ];
    for (const name of edge.names) {
      const child = normalizePath([...stemParts, name]);
      candidates.push(`${child}.py`, `${child}/__init__.py`);
    }
    return candidates.find((c) => available.has(c)) ?? null;
  }

  // Absolute import
  const norm = normalizePath(moduleParts);
  const candidates = [
    `${norm}.py`,
    `${norm}/__init__.py`,
    `${norm}.pyi`,
  ];
  for (const name of edge.names) {
    const child = normalizePath([...moduleParts, name]);
    candidates.push(`${child}.py`, `${child}/__init__.py`);
  }
  const rootMatch = candidates.find((c) => available.has(c));
  if (rootMatch) return rootMatch;

  for (const root of packageRoots) {
    const rootedStem = normalizePath([root, ...moduleParts]);
    const rootedCandidates = [
      `${rootedStem}.py`,
      `${rootedStem}/__init__.py`,
      `${rootedStem}.pyi`,
    ];
    for (const name of edge.names) {
      const child = normalizePath([root, ...moduleParts, name]);
      rootedCandidates.push(`${child}.py`, `${child}/__init__.py`);
    }
    const match = rootedCandidates.find((c) => available.has(c));
    if (match) return match;
  }

  return null;
}

function resolveJavaScriptImport(edge: ImportRecord, available: Set<string>, pathAliases: Record<string, string>): string | null {
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
  const moduleName = edge.module;

  if (moduleName.startsWith('.')) {
    const sourceParts = edge.source.split('/');
    sourceParts.pop();
    const stem = normalizePath([...sourceParts, ...moduleName.split('/')]);
    const candidates = [stem, ...extensions.map((ext) => stem + ext), ...extensions.map((ext) => `${stem}/index${ext}`)];
    return candidates.find((c) => available.has(c)) ?? null;
  }

  for (const [prefix, dest] of Object.entries(pathAliases)) {
    if (prefix && (moduleName === prefix || moduleName.startsWith(prefix + '/'))) {
      const subpath = moduleName.slice(prefix.length).replace(/^\/+/, '');
      const stem = dest ? normalizePath([...dest.split('/'), ...subpath.split('/')]) : normalizePath(subpath.split('/'));
      const candidates = [stem, ...extensions.map((ext) => stem + ext), ...extensions.map((ext) => `${stem}/index${ext}`)];
      const match = candidates.find((c) => available.has(c));
      if (match) return match;
    }
  }

  return null;
}

/**
 * Resolve Go-style package imports. Go imports reference package directories
 * (often fully qualified, e.g. github.com/owner/repo/render); we match the
 * longest suffix of the module path against directories containing non-test
 * Go files and target the lexicographically first file deterministically.
 */
function resolveGoImport(edge: ImportRecord, available: Set<string>): string | null {
  const segments = edge.module.split('/').filter(Boolean);
  const maxTake = Math.min(segments.length, 4);
  for (let take = maxTake; take >= 1; take--) {
    const suffix = segments.slice(-take).join('/');
    const matches: string[] = [];
    for (const path of available) {
      if (!path.endsWith('.go') || path.endsWith('_test.go')) continue;
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      if (dir === suffix || dir.endsWith(`/${suffix}`)) matches.push(path);
    }
    if (matches.length > 0) return matches.sort()[0];
  }
  return null;
}

export function resolveImports(imports: ImportRecord[], files: FileRecord[], pathAliases: Record<string, string> = {}): void {
  const available = new Set(files.map((f) => f.path));
  const packageRoots = detectPackageRoots(available);

  for (const edge of imports) {
    if (edge.source.endsWith('.py') || edge.source.endsWith('.pyi')) {
      edge.target = resolvePythonImport(edge, available, packageRoots);
      edge.external = edge.target === null && !edge.module.startsWith('.');
    } else if (edge.source.endsWith('.go')) {
      edge.target = resolveGoImport(edge, available);
      edge.external = edge.target === null && !edge.module.startsWith('.');
    } else {
      edge.target = resolveJavaScriptImport(edge, available, pathAliases);
      edge.external = edge.target === null && !edge.module.startsWith('.');
    }
  }
}

export function resolveCalls(calls: CallRecord[], symbols: SymbolRecord[], imports: ImportRecord[] = []): void {
  const byName = new Map<string, SymbolRecord[]>();
  const byFileAndName = new Map<string, SymbolRecord[]>();

  for (const symbol of symbols) {
    if (symbol.type !== 'module') {
      if (!byName.has(symbol.name)) byName.set(symbol.name, []);
      byName.get(symbol.name)!.push(symbol);

      const fileKey = `${symbol.file}::${symbol.name}`;
      if (!byFileAndName.has(fileKey)) byFileAndName.set(fileKey, []);
      byFileAndName.get(fileKey)!.push(symbol);
    }
  }

  const importedTargetsByFile = new Map<string, Set<string>>();
  for (const edge of imports) {
    if (edge.target) {
      if (!importedTargetsByFile.has(edge.source)) importedTargetsByFile.set(edge.source, new Set());
      importedTargetsByFile.get(edge.source)!.add(edge.target);
    }
  }

  for (const edge of calls) {
    const callee = edge.callee;
    const name = callee.split('.').pop()!;

    // 1. Cross-file imported symbol resolution
    if (callee.includes('.') && importedTargetsByFile.has(edge.file)) {
      const targets = importedTargetsByFile.get(edge.file)!;
      for (const targetFile of targets) {
        const fileKey = `${targetFile}::${name}`;
        const matched = byFileAndName.get(fileKey) ?? [];
        if (matched.length === 1) {
          edge.target = matched[0].id;
          edge.confidence = 0.92;
          break;
        }
      }
      if (edge.target) continue;
    }

    // 2. Same-file match
    const sameFileKey = `${edge.file}::${name}`;
    const sameFileMatches = byFileAndName.get(sameFileKey) ?? [];
    if (sameFileMatches.length === 1) {
      edge.target = sameFileMatches[0].id;
      edge.confidence = 0.88;
      continue;
    }

    // 3. Global unambiguous match
    const globalMatches = byName.get(name) ?? [];
    if (globalMatches.length === 1) {
      edge.target = globalMatches[0].id;
      edge.confidence = callee.includes('.') ? 0.82 : 0.72;
    }
  }
}

export function classifyFile(path: string, routeFiles: Set<string>, symbolTypes: Set<string>): [category: string, evidence: string[]] {
  const lowered = path.toLowerCase();
  const parts = new Set(lowered.split('/'));

  if (parts.has('tests') || parts.has('test') || lowered.endsWith('.test.ts') || lowered.endsWith('.test.tsx') || lowered.endsWith('.spec.ts') || lowered.endsWith('_test.py') || lowered.endsWith('test.py')) {
    return ['tests', ['test path or filename']];
  }
  if (routeFiles.has(path) || ['api', 'routes', 'routers', 'controllers', 'endpoints'].some((p) => parts.has(p))) {
    return ['api', ['contains or groups request handlers']];
  }
  if (['services', 'service', 'usecases', 'use_cases'].some((p) => parts.has(p))) {
    return ['services', ['service or use-case path']];
  }
  if (['repositories', 'repository', 'dao'].some((p) => parts.has(p))) {
    return ['repositories', ['repository or DAO path']];
  }
  if (['models', 'database', 'db', 'migrations', 'schema', 'entities'].some((p) => parts.has(p)) || symbolTypes.has('database_model')) {
    return ['database', ['database path or ORM model evidence']];
  }
  if (['workers', 'worker', 'jobs', 'tasks', 'queues'].some((p) => parts.has(p))) {
    return ['workers', ['worker, job, or queue path']];
  }
  if (['frontend', 'client', 'components', 'pages', 'views', 'ui'].some((p) => parts.has(p)) || symbolTypes.has('component')) {
    return ['frontend', ['frontend path or component symbols']];
  }
  if (['domain', 'core'].some((p) => parts.has(p))) {
    return ['domain', ['domain or core path']];
  }
  if (['infra', 'infrastructure', '.github', 'deploy'].some((p) => parts.has(p)) || ['dockerfile', 'docker-compose.yml', 'compose.yml'].includes(path.split('/').pop()!.toLowerCase())) {
    return ['infrastructure', ['infrastructure manifest or path']];
  }
  if (['.json', '.toml', '.yaml', '.yml', '.ini', '.cfg'].some((ext) => lowered.endsWith(ext))) {
    return ['configuration', ['configuration file']];
  }
  if (['src', 'app'].some((p) => parts.has(p))) {
    return ['frontend', ['frontend container path']];
  }
  return ['other', ['source file outside a recognized layer']];
}

export function buildArchitecture(
  files: FileRecord[],
  symbols: SymbolRecord[],
  imports: ImportRecord[],
  routes: RouteRecord[]
): {
  architecture: { components: ArchitectureComponent[]; connections: ArchitectureConnection[] };
  fileComponents: Record<string, string>;
} {
  const routeFiles = new Set(routes.map((r) => r.file));
  const symbolTypesByFile = new Map<string, Set<string>>();
  for (const s of symbols) {
    if (!symbolTypesByFile.has(s.file)) symbolTypesByFile.set(s.file, new Set());
    symbolTypesByFile.get(s.file)!.add(s.type);
  }

  const groups: Record<string, string[]> = {};
  const evidence: Record<string, Set<string>> = {};
  const fileComponents: Record<string, string> = {};

  for (const file of files) {
    const [component, reasons] = classifyFile(file.path, routeFiles, symbolTypesByFile.get(file.path) ?? new Set());
    if (!groups[component]) groups[component] = [];
    if (!evidence[component]) evidence[component] = new Set();
    groups[component].push(file.path);
    reasons.forEach((r) => evidence[component].add(r));
    fileComponents[file.path] = component;
  }

  const components: ArchitectureComponent[] = [];
  for (const type of COMPONENT_ORDER) {
    const paths = groups[type];
    if (!paths || paths.length === 0) continue;
    const confidence = ['api', 'database', 'tests'].includes(type) ? 0.94 : 0.82;
    components.push({
      id: type,
      name: COMPONENT_NAMES[type] ?? type,
      type,
      files: paths.sort(),
      confidence,
      evidence: Array.from(evidence[type]).sort(),
    });
  }

  const connectionCounts = new Map<string, number>();
  for (const edge of imports) {
    if (!edge.target) continue;
    const source = fileComponents[edge.source];
    const target = fileComponents[edge.target];
    if (source && target && source !== target) {
      const key = `${source}::${target}`;
      connectionCounts.set(key, (connectionCounts.get(key) ?? 0) + 1);
    }
  }

  const connections: ArchitectureConnection[] = [];
  for (const [key, weight] of Array.from(connectionCounts.entries()).sort()) {
    const [source, target] = key.split('::');
    connections.push({
      id: `component:${source}:${target}`,
      source,
      target,
      type: 'imports',
      weight,
    });
  }

  return {
    architecture: { components, connections },
    fileComponents,
  };
}

export function rankEntrypoints(files: FileRecord[], partials: PartialAnalysis[]): EntrypointRecord[] {
  const evidenceByFile = new Map<string, string[]>();
  for (const partial of partials) {
    evidenceByFile.set(partial.file.path, partial.entrypointEvidence);
  }

  const conventional: Record<string, number> = {
    'main.py': 30, '__main__.py': 35, 'app.py': 24, 'server.py': 25, 'wsgi.py': 20, 'asgi.py': 22,
    'index.js': 22, 'index.ts': 22, 'server.js': 28, 'server.ts': 28,
    'main.js': 24, 'main.ts': 24, 'main.tsx': 26,
  };

  const entries: EntrypointRecord[] = [];
  for (const file of files) {
    const filename = file.path.split('/').pop()!;
    const reasons = Array.from(new Set(evidenceByFile.get(file.path) ?? []));
    const score = (conventional[filename] ?? 0) + 35 * reasons.length;
    if (!score) continue;
    if (conventional[filename]) reasons.push(`uses the conventional ${filename} filename`);

    entries.push({
      id: `entrypoint:${file.path}`,
      file: file.path,
      kind: 'application',
      score,
      confidence: Math.min(0.99, 0.45 + score / 150),
      evidence: Array.from(new Set(reasons)),
    });
  }

  return entries.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file)).slice(0, 10);
}

export function buildFlows(routes: RouteRecord[], calls: CallRecord[], symbols: SymbolRecord[], limit = 12): FlowRecord[] {
  const outgoing = new Map<string, CallRecord[]>();
  for (const call of calls) {
    if (call.target) {
      if (!outgoing.has(call.source)) outgoing.set(call.source, []);
      outgoing.get(call.source)!.push(call);
    }
  }

  const symbolById = new Map<string, SymbolRecord>();
  for (const symbol of symbols) {
    symbolById.set(symbol.id, symbol);
  }

  const flows: FlowRecord[] = [];
  for (const route of routes) {
    const nodes = [{ id: route.id, type: 'route', label: `${route.method} ${route.path}`, file: route.file, line: route.line }];
    const edges: { source: string; target: string; type: string }[] = [];
    const visited = new Set<string>([route.handler]);
    const queue: [string, number][] = [[route.handler, 0]];

    const handlerSymbol = symbolById.get(route.handler);
    if (handlerSymbol) {
      nodes.push({ id: handlerSymbol.id, type: handlerSymbol.type, label: handlerSymbol.name, file: handlerSymbol.file, line: handlerSymbol.line });
      edges.push({ source: route.id, target: handlerSymbol.id, type: 'handles' });
    }

    while (queue.length > 0 && nodes.length < limit) {
      const [source, depth] = queue.shift()!;
      if (depth >= 5) continue;
      const outgoingCalls = outgoing.get(source) ?? [];
      for (const call of outgoingCalls) {
        if (!call.target || visited.has(call.target)) continue;
        visited.add(call.target);
        const target = symbolById.get(call.target);
        if (target) {
          nodes.push({ id: target.id, type: target.type, label: target.name, file: target.file, line: target.line });
          edges.push({ source, target: target.id, type: 'calls' });
          queue.push([target.id, depth + 1]);
        }
        if (nodes.length >= limit) break;
      }
    }

    flows.push({
      id: `flow:${route.id}`,
      name: `${route.method} ${route.path}`,
      confidence: nodes.length > 1 ? 0.86 : 0.6,
      nodes,
      edges,
    });
  }

  return flows;
}

export function rankImportantFiles(
  files: FileRecord[],
  imports: ImportRecord[],
  routes: RouteRecord[],
  entrypoints: EntrypointRecord[]
): { file: string; score: number; reasons: string[] }[] {
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  const routeCount = new Map<string, number>();
  const entryScores = new Map<string, number>();

  for (const edge of imports) {
    if (edge.target) {
      inbound.set(edge.target, (inbound.get(edge.target) ?? 0) + 1);
      outbound.set(edge.source, (outbound.get(edge.source) ?? 0) + 1);
    }
  }
  for (const route of routes) {
    routeCount.set(route.file, (routeCount.get(route.file) ?? 0) + 1);
  }
  for (const entry of entrypoints) {
    entryScores.set(entry.file, entry.score);
  }

  const ranked: { file: string; score: number; reasons: string[] }[] = [];
  for (const file of files) {
    const filename = file.path.split('/').pop()!;
    const configWeight = ['package.json', 'pyproject.toml', 'Dockerfile', 'tsconfig.json'].includes(filename) ? 12 : 0;
    const inCount = inbound.get(file.path) ?? 0;
    const outCount = outbound.get(file.path) ?? 0;
    const rCount = routeCount.get(file.path) ?? 0;
    const eScore = entryScores.get(file.path) ?? 0;

    const score = inCount * 3 + outCount * 2 + rCount * 8 + eScore + configWeight;
    if (score > 0) {
      const reasons: string[] = [];
      if (eScore > 0) reasons.push('entrypoint candidate');
      if (rCount > 0) reasons.push(`defines ${rCount} route(s)`);
      if (inCount > 0) reasons.push(`imported by ${inCount} file(s)`);
      if (outCount > 0) reasons.push(`imports ${outCount} local file(s)`);
      if (configWeight > 0) reasons.push('project configuration');
      ranked.push({ file: file.path, score, reasons });
    }
  }

  return ranked.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file)).slice(0, 20);
}

export function onboardingTour(
  entrypoints: EntrypointRecord[],
  architecture: { components: ArchitectureComponent[] },
  importantFiles: { file: string; reasons: string[] }[]
): { step: number; title: string; file: string; description: string }[] {
  const steps: { step: number; title: string; file: string; description: string }[] = [];
  if (entrypoints.length > 0) {
    const entry = entrypoints[0];
    steps.push({
      step: 1,
      title: 'Start at the entry point',
      file: entry.file,
      description: entry.evidence.slice(0, 2).join('; '),
    });
  }

  const descriptions: Record<string, string> = {
    api: 'Requests enter the application through these handlers.',
    services: 'Business behavior is coordinated in this layer.',
    domain: 'Core concepts and rules live here.',
    repositories: 'Persistence access is isolated here.',
    database: 'Models, schema, and database wiring live here.',
    workers: 'Asynchronous and long-running work begins here.',
  };

  for (const component of architecture.components) {
    if (descriptions[component.type] && component.files.length > 0) {
      steps.push({
        step: steps.length + 1,
        title: `Explore ${component.name}`,
        file: component.files[0],
        description: descriptions[component.type],
      });
    }
    if (steps.length >= 6) break;
  }

  for (const item of importantFiles) {
    if (steps.length >= 6) break;
    if (!steps.some((s) => s.file === item.file)) {
      steps.push({
        step: steps.length + 1,
        title: 'Read a central file',
        file: item.file,
        description: item.reasons.slice(0, 2).join(', '),
      });
    }
  }

  return steps;
}

export function graphMetrics(files: FileRecord[], imports: ImportRecord[], symbols: SymbolRecord[]): {
  complexityScore: number;
  localDependencies: number;
  externalDependencies: number;
  dependencyCycles: string[][];
  mostConnectedFiles: { file: string; connections: number }[];
  highCouplingFiles: { file: string; connections: number }[];
} {
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  const graph = new Map<string, Set<string>>();

  let localDeps = 0;
  let extDeps = 0;

  for (const edge of imports) {
    if (edge.target && edge.target !== edge.source) {
      localDeps++;
      inbound.set(edge.target, (inbound.get(edge.target) ?? 0) + 1);
      outbound.set(edge.source, (outbound.get(edge.source) ?? 0) + 1);
      if (!graph.has(edge.source)) graph.set(edge.source, new Set());
      graph.get(edge.source)!.add(edge.target);
    } else if (edge.external) {
      extDeps++;
    }
  }

  // Cycles detection
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const active = new Set<string>();
  const path: string[] = [];

  function dfs(node: string) {
    if (active.has(node)) {
      const idx = path.indexOf(node);
      if (idx !== -1) {
        cycles.push(path.slice(idx));
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    active.add(node);
    path.push(node);

    const neighbors = graph.get(node) ?? new Set();
    for (const neighbor of neighbors) {
      dfs(neighbor);
    }

    path.pop();
    active.delete(node);
  }

  for (const node of graph.keys()) {
    dfs(node);
  }

  const meaningfulCycles = filterMeaningfulDependencyCycles(cycles);

  const mostConnected = files
    .map((f) => ({
      file: f.path,
      connections: (inbound.get(f.path) ?? 0) + (outbound.get(f.path) ?? 0),
    }))
    .filter((item) => item.connections > 0)
    .sort((a, b) => b.connections - a.connections || a.file.localeCompare(b.file));

  const complexity = Math.min(
    100,
    Math.round(files.length * 0.15 + symbols.length * 0.04 + localDeps * 0.1 + meaningfulCycles.length * 5)
  );

  return {
    complexityScore: complexity,
    localDependencies: localDeps,
    externalDependencies: extDeps,
    dependencyCycles: meaningfulCycles.slice(0, 10),
    mostConnectedFiles: mostConnected.slice(0, 10),
    highCouplingFiles: mostConnected.filter((item) => item.connections > 20),
  };
}
