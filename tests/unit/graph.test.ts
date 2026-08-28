import { describe, expect, it } from 'vitest';
import {
  buildArchitecture,
  graphMetrics,
  resolveCalls,
  resolveImports,
} from '../../app/lib/analyzer/graph';
import type { CallRecord, FileRecord, ImportRecord, RouteRecord, SymbolRecord } from '../../app/lib/analyzer/types';

describe('Graph Resolution & Architecture Engine', () => {
  it('resolves Python relative and package-root imports', () => {
    const files: FileRecord[] = [
      { id: 'f1', path: 'src/app/main.py', language: 'Python', lines: 10, bytes: 100, hash: 'h1', role: 'source', parsed: true, error: null },
      { id: 'f2', path: 'src/app/services/user.py', language: 'Python', lines: 20, bytes: 200, hash: 'h2', role: 'source', parsed: true, error: null },
      { id: 'f3', path: 'src/app/__init__.py', language: 'Python', lines: 1, bytes: 10, hash: 'h3', role: 'source', parsed: true, error: null },
    ];

    const imports: ImportRecord[] = [
      { id: 'i1', source: 'src/app/main.py', module: '.services.user', names: ['UserService'], line: 1, target: null, external: false },
      { id: 'i2', source: 'src/app/main.py', module: 'app.services.user', names: ['UserService'], line: 2, target: null, external: false },
    ];

    resolveImports(imports, files);

    expect(imports[0].target).toBe('src/app/services/user.py');
    expect(imports[1].target).toBe('src/app/services/user.py');
  });

  it('resolves TypeScript path aliases and relative imports', () => {
    const files: FileRecord[] = [
      { id: 'f1', path: 'src/pages/index.tsx', language: 'TypeScript', lines: 10, bytes: 100, hash: 'h1', role: 'source', parsed: true, error: null },
      { id: 'f2', path: 'src/components/Button.tsx', language: 'TypeScript', lines: 20, bytes: 200, hash: 'h2', role: 'source', parsed: true, error: null },
    ];

    const imports: ImportRecord[] = [
      { id: 'i1', source: 'src/pages/index.tsx', module: '@/components/Button', names: ['Button'], line: 1, target: null, external: false },
      { id: 'i2', source: 'src/pages/index.tsx', module: '../components/Button', names: ['Button'], line: 2, target: null, external: false },
    ];

    const pathAliases = { '@': 'src' };
    resolveImports(imports, files, pathAliases);

    expect(imports[0].target).toBe('src/components/Button.tsx');
    expect(imports[1].target).toBe('src/components/Button.tsx');
  });

  it('resolves cross-file symbol calls', () => {
    const symbols: SymbolRecord[] = [
      { id: 'src/services/user.ts::createUser', name: 'createUser', type: 'function', file: 'src/services/user.ts', line: 5, end_line: 15, parent: null, exported: true, evidence: [] },
    ];

    const imports: ImportRecord[] = [
      { id: 'i1', source: 'src/routes/user.ts', module: '../services/user', names: ['createUser'], line: 1, target: 'src/services/user.ts', external: false },
    ];

    const calls: CallRecord[] = [
      { id: 'c1', source: 'src/routes/user.ts::handler', callee: 'userService.createUser', file: 'src/routes/user.ts', line: 10, target: null, confidence: 0.5 },
    ];

    resolveCalls(calls, symbols, imports);
    expect(calls[0].target).toBe('src/services/user.ts::createUser');
  });

  it('builds architecture layers and connections', () => {
    const files: FileRecord[] = [
      { id: 'f1', path: 'src/routes/api.ts', language: 'TypeScript', lines: 10, bytes: 100, hash: 'h1', role: 'source', parsed: true, error: null },
      { id: 'f2', path: 'src/services/auth.ts', language: 'TypeScript', lines: 10, bytes: 100, hash: 'h2', role: 'source', parsed: true, error: null },
      { id: 'f3', path: 'src/models/user.ts', language: 'TypeScript', lines: 10, bytes: 100, hash: 'h3', role: 'source', parsed: true, error: null },
    ];

    const imports: ImportRecord[] = [
      { id: 'i1', source: 'src/routes/api.ts', module: '../services/auth', names: [], line: 1, target: 'src/services/auth.ts', external: false },
      { id: 'i2', source: 'src/services/auth.ts', module: '../models/user', names: [], line: 1, target: 'src/models/user.ts', external: false },
    ];

    const routes: RouteRecord[] = [
      { id: 'r1', method: 'GET', path: '/api/v1', handler: 'src/routes/api.ts::handler', file: 'src/routes/api.ts', line: 5, framework: 'Express', confidence: 0.95 },
    ];

    const { architecture } = buildArchitecture(files, [], imports, routes);
    const componentTypes = architecture.components.map((c) => c.type);

    expect(componentTypes).toContain('api');
    expect(componentTypes).toContain('services');
    expect(componentTypes).toContain('database');
    expect(architecture.connections.length).toBe(2);
  });

  it('detects cycles and computes complexity metrics', () => {
    const files: FileRecord[] = [
      { id: 'f1', path: 'src/a.ts', language: 'TypeScript', lines: 10, bytes: 100, hash: 'h1', role: 'source', parsed: true, error: null },
      { id: 'f2', path: 'src/b.ts', language: 'TypeScript', lines: 10, bytes: 100, hash: 'h2', role: 'source', parsed: true, error: null },
    ];

    const imports: ImportRecord[] = [
      { id: 'i1', source: 'src/a.ts', module: './b', names: [], line: 1, target: 'src/b.ts', external: false },
      { id: 'i2', source: 'src/b.ts', module: './a', names: [], line: 1, target: 'src/a.ts', external: false },
    ];

    const metrics = graphMetrics(files, imports, []);
    expect(metrics.dependencyCycles.length).toBeGreaterThan(0);
    expect(metrics.localDependencies).toBe(2);
  });

  it('does not treat a self-referential import as a dependency cycle', () => {
    const files: FileRecord[] = [
      { id: 'f1', path: 'src/self.ts', language: 'TypeScript', lines: 10, bytes: 100, hash: 'h1', role: 'source', parsed: true, error: null },
    ];
    const imports: ImportRecord[] = [
      { id: 'i1', source: 'src/self.ts', module: './self', names: [], line: 1, target: 'src/self.ts', external: false },
    ];

    const metrics = graphMetrics(files, imports, []);

    expect(metrics.dependencyCycles).toEqual([]);
    expect(metrics.localDependencies).toBe(0);
  });
});

describe('graphMetrics ranking', () => {
  it('excludes files with zero connections and resolves Go package imports', () => {
    const files: FileRecord[] = [
      { id: 'f0', path: 'main.go', language: 'Go', lines: 50, bytes: 500, hash: 'h0', role: 'source', parsed: true, error: null },
      { id: 'f1', path: 'render/json.go', language: 'Go', lines: 100, bytes: 1000, hash: 'h1', role: 'source', parsed: true, error: null },
      { id: 'f2', path: 'render/yaml.go', language: 'Go', lines: 80, bytes: 800, hash: 'h2', role: 'source', parsed: true, error: null },
      { id: 'f3', path: '.github/dependabot.yml', language: 'YAML', lines: 10, bytes: 100, hash: 'h3', role: 'config', parsed: true, error: null },
    ];

    const imports: ImportRecord[] = [
      { id: 'i1', source: 'main.go', module: 'github.com/example/project/render', names: ['render'], line: 3, target: null, external: false },
      { id: 'i2', source: 'render/json.go', module: 'github.com/example/project', names: ['project'], line: 5, target: null, external: false },
    ];
    resolveImports(imports, files);

    // Longest-suffix match targets the render package deterministically.
    expect(imports[0].target).toBe('render/json.go');

    const metrics = graphMetrics(files, imports, []);
    expect(metrics.mostConnectedFiles.length).toBeGreaterThan(0);
    for (const entry of metrics.mostConnectedFiles) {
      expect(entry.connections).toBeGreaterThan(0);
      expect(entry.file).not.toMatch(/^\.github\//);
    }
  });
});
