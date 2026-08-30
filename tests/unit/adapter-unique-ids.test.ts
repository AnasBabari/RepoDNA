import { describe, expect, it } from 'vitest';

import { adaptV1ToV2Viewer } from '../../app/lib/schema/artifact-loader';
import type { RepoDNAProject } from '../../app/lib/types';

/**
 * Regression tests for duplicate graph node/edge ids.
 *
 * v1 symbol ids are `file::qualifiedName`, so two distinct symbols in one file
 * with the same qualified name (e.g. callback parameters in different closures)
 * collided, and identical call records produced identical edge ids. The v2
 * adapter must emit unique node and edge ids while preserving every distinct
 * relationship and its evidence.
 */

function baseProject(overrides: Partial<RepoDNAProject>): RepoDNAProject {
  return {
    schemaVersion: '1.1.0',
    generatedAt: '2026-08-30T00:00:00.000Z',
    repository: {
      name: 'x', source: 'https://github.com/x/x',
      languages: {}, fileCount: 1, sourceFileCount: 1, parsedFileCount: 1, lines: 40,
      fingerprint: {
        languages: [], frameworks: [], infrastructure: [], databases: [],
        externalSystems: [], testing: [], buildTools: [],
      },
    },
    technologies: [],
    files: [
      { id: 'file:app.js', path: 'app.js', language: 'JavaScript', lines: 40, bytes: 400, hash: 'h1', role: 'source', parsed: true, error: null },
    ],
    symbols: [], imports: [], calls: [], routes: [],
    databases: [], external_systems: [],
    entrypoints: [], flows: [],
    architecture: { components: [], connections: [] },
    important_files: [], onboarding: [],
    metrics: {
      complexityScore: 0, localDependencies: 0, externalDependencies: 0,
      dependencyCycles: [], mostConnectedFiles: [], highCouplingFiles: [],
      symbols: 0, routes: 0, components: 0, parseSuccessRate: 100,
    },
    diagnostics: [],
    metadata: {
      analysisMode: 'test', executedRepositoryCode: false,
      limits: { maxFiles: 10, maxFileBytes: 100 },
      fileComponents: {}, cache: { hits: 0, misses: 0 },
    },
    ...overrides,
  };
}

describe('v2 adapter id uniqueness', () => {
  it('disambiguates two symbols in one file sharing a qualified name', () => {
    const project = baseProject({
      symbols: [
        { id: 'app.js::args', type: 'variable', name: 'args', file: 'app.js', line: 10, end_line: null, parent: null, exported: false, evidence: [] },
        { id: 'app.js::args', type: 'variable', name: 'args', file: 'app.js', line: 30, end_line: null, parent: null, exported: false, evidence: [] },
      ],
    });

    const v2 = adaptV1ToV2Viewer(project);
    const symbolNodes = v2.nodes.filter((node) => node.path === 'app.js' && node.kind === 'variable');
    expect(symbolNodes).toHaveLength(2);
    const ids = new Set(symbolNodes.map((node) => node.id));
    expect(ids.size).toBe(2);
    // The first occurrence keeps the canonical id; the second is line-disambiguated.
    expect(symbolNodes.map((node) => node.id).sort()).toEqual(['app.js::args', 'app.js::args:30']);

    const defineEdges = v2.edges.filter((edge) => edge.type === 'DEFINES');
    expect(defineEdges).toHaveLength(2);
    expect(new Set(defineEdges.map((edge) => edge.id)).size).toBe(2);
    // Both define edges must resolve to existing nodes.
    const nodeIds = new Set(v2.nodes.map((node) => node.id));
    for (const edge of defineEdges) {
      expect(nodeIds.has(edge.target ?? '')).toBe(true);
    }
  });

  it('disambiguates a three-way symbol collision deterministically', () => {
    const project = baseProject({
      symbols: [10, 20, 30].map((line) => (
        { id: 'app.js::done', type: 'variable', name: 'done', file: 'app.js', line, end_line: null, parent: null, exported: false, evidence: [] }
      )),
    });

    const v2 = adaptV1ToV2Viewer(project);
    const ids = v2.nodes.filter((node) => node.kind === 'variable').map((node) => node.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.sort()).toEqual(['app.js::done', 'app.js::done:20', 'app.js::done:30']);

    // Deterministic across repeated runs.
    const again = adaptV1ToV2Viewer(project);
    expect(again.nodes.map((node) => node.id)).toEqual(v2.nodes.map((node) => node.id));
  });

  it('drops exactly-identical duplicate call edges without losing distinct ones', () => {
    const duplicateCall = {
      id: 'app.js:call:42:type',
      source: 'app.js',
      callee: 'type',
      file: 'app.js',
      line: 42,
      target: null,
      confidence: 0.55,
    };
    const distinctCall = { ...duplicateCall, id: 'app.js:call:44:len', line: 44, callee: 'len' };
    const project = baseProject({ calls: [duplicateCall, duplicateCall, distinctCall] });

    const v2 = adaptV1ToV2Viewer(project);
    const callEdges = v2.edges.filter((edge) => edge.type === 'CALLS');
    expect(callEdges).toHaveLength(2);
    expect(new Set(callEdges.map((edge) => edge.id)).size).toBe(2);
  });

  it('disambiguates colliding edge ids when content differs', () => {
    const project = baseProject({
      calls: [
        { id: 'app.js:call:42:type', source: 'app.js', callee: 'type', file: 'app.js', line: 42, target: null, confidence: 0.55 },
        { id: 'app.js:call:42:type', source: 'app.js', callee: 'other', file: 'app.js', line: 42, target: null, confidence: 0.4 },
      ],
    });

    const v2 = adaptV1ToV2Viewer(project);
    const callEdges = v2.edges.filter((edge) => edge.type === 'CALLS');
    expect(callEdges).toHaveLength(2);
    expect(new Set(callEdges.map((edge) => edge.id)).size).toBe(2);
    // Neither relationship's callee information is lost.
    expect(callEdges.map((edge) => edge.metadata?.callee).sort()).toEqual(['other', 'type']);
  });

  it('disambiguates identical duplicate route records and keeps edges pointing at real nodes', () => {
    const route = {
      id: 'route:app.js:7:GET:/x',
      method: 'GET',
      path: '/x',
      handler: 'app.js::handler',
      file: 'app.js',
      line: 7,
      framework: 'express',
      confidence: 0.9,
    };
    const project = baseProject({
      routes: [route, route],
      symbols: [
        { id: 'app.js::handler', type: 'function', name: 'handler', file: 'app.js', line: 5, end_line: null, parent: null, exported: true, evidence: [] },
      ],
    });

    const v2 = adaptV1ToV2Viewer(project);
    const routeNodes = v2.nodes.filter((node) => node.kind === 'route');
    expect(routeNodes).toHaveLength(2);
    expect(new Set(routeNodes.map((node) => node.id)).size).toBe(2);

    const exposesEdges = v2.edges.filter((edge) => edge.type === 'EXPOSES_ROUTE');
    expect(exposesEdges).toHaveLength(2);
    expect(new Set(exposesEdges.map((edge) => edge.id)).size).toBe(2);

    const nodeIds = new Set(v2.nodes.map((node) => node.id));
    for (const edge of [...exposesEdges, ...v2.edges.filter((e) => e.type === 'HANDLES')]) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(edge.target === null || nodeIds.has(edge.target)).toBe(true);
    }
  });

  it('produces zero duplicate node or edge ids on an adversarial combined artifact', () => {
    const symbol = (line: number) => (
      { id: 'app.js::run', type: 'function', name: 'run', file: 'app.js', line, end_line: null, parent: null, exported: true, evidence: [] }
    );
    const project = baseProject({
      symbols: [symbol(1), symbol(2), symbol(3)],
      routes: [
        { id: 'route:app.js:1:GET:/a', method: 'GET', path: '/a', handler: 'app.js::run', file: 'app.js', line: 1, framework: 'express', confidence: 0.9 },
        { id: 'route:app.js:1:GET:/a', method: 'GET', path: '/a', handler: 'app.js::run', file: 'app.js', line: 1, framework: 'express', confidence: 0.9 },
      ],
      imports: [
        { id: 'i1', source: 'app.js', module: 'express', names: [], line: 1, target: null, external: true },
        { id: 'i1', source: 'app.js', module: 'express', names: [], line: 1, target: null, external: true },
      ],
      calls: [
        { id: 'app.js::run:call:2:log', source: 'app.js::run', callee: 'log', file: 'app.js', line: 2, target: null, confidence: 0.5 },
        { id: 'app.js::run:call:2:log', source: 'app.js::run', callee: 'log', file: 'app.js', line: 2, target: null, confidence: 0.5 },
      ],
    });

    const v2 = adaptV1ToV2Viewer(project);
    expect(new Set(v2.nodes.map((node) => node.id)).size).toBe(v2.nodes.length);
    expect(new Set(v2.edges.map((edge) => edge.id)).size).toBe(v2.edges.length);
  });

  it('does not fabricate package nodes for asset or tsconfig-alias imports', () => {
    const project = baseProject({
      imports: [
        { id: 'asset', source: 'app.js', module: '/assets/logo.svg', names: ['logo'], line: 2, target: null, external: true },
        { id: 'alias', source: 'app.js', module: '@/components/Button', names: ['Button'], line: 3, target: null, external: true },
        { id: 'scoped', source: 'app.js', module: '@scope/package/subpath', names: ['value'], line: 4, target: null, external: true },
      ],
    });

    const v2 = adaptV1ToV2Viewer(project);
    const byId = new Map(v2.edges.map((edge) => [edge.id, edge]));
    expect(byId.get('asset')).toMatchObject({ target: null, status: 'unresolved' });
    expect(byId.get('alias')).toMatchObject({ target: null, status: 'unresolved' });
    expect(byId.get('scoped')).toMatchObject({ target: 'dependency:@scope/package', status: 'resolved' });
    expect(v2.nodes.some((node) => node.id === 'dependency:')).toBe(false);
    expect(v2.nodes.some((node) => node.id === 'dependency:@')).toBe(false);
  });
});
