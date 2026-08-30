import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRepoDNAProject, validateRepoDNAProjectV2 } from '../../app/lib/schema/safe-validator';
import { assertImportedArtifactSize, MAX_IMPORTED_ARTIFACT_BYTES } from '../../app/lib/schema/artifact-loader';
import type { RepoDNAProject } from '../../app/lib/types';
import { makeV2Fixture } from './export/fixtures';

/**
 * Regression tests for the CSP hydration bug:
 * Ajv compiles validators via `new Function`, which throws EvalError under a
 * Content-Security-Policy without 'unsafe-eval'. Module-scope compilation
 * crashed React hydration on production, leaving a blank page.
 *
 * These tests simulate the blocked-eval environment and assert that validation
 * still enforces required structure through the structural fallback path.
 */

describe('CSP-safe schema fallback', () => {
  const globalAny = globalThis as typeof globalThis & {
    __repodnaAjvV1?: unknown;
    __repodnaAjvV2?: unknown;
  };

  beforeEach(() => {
    // Simulate the browser where ajv compile failed: cached engine is null.
    delete globalAny.__repodnaAjvV1;
    delete globalAny.__repodnaAjvV2;
  });

  afterEach(() => {
    delete globalAny.__repodnaAjvV1;
    delete globalAny.__repodnaAjvV2;
  });

  function minimalProject(): RepoDNAProject {
    return {
      schemaVersion: '1.1.0',
      generatedAt: '2026-01-01T00:00:00.000Z',
      repository: {
        name: 'x', source: 'https://github.com/x/x',
        languages: {}, fileCount: 0, sourceFileCount: 0, parsedFileCount: 0, lines: 0,
        fingerprint: {
          languages: [], frameworks: [], infrastructure: [], databases: [],
          externalSystems: [], testing: [], buildTools: [],
        },
      },
      technologies: [],
      files: [], symbols: [], imports: [], calls: [], routes: [],
      databases: [], external_systems: [],
      entrypoints: [], flows: [],
      architecture: { components: [], connections: [] },
      important_files: [],
      onboarding: [],
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
    };
  }

  it('accepts a fully-formed artifact when the ajv engine is unavailable', () => {
    // Force the structural path by poisoning the cache the way EvalError would.
    globalAny.__repodnaAjvV1 = null;
    const result = validateRepoDNAProject(minimalProject());
    expect(result.valid).toBe(true);
  });

  it('rejects artifacts missing required top-level collections without ajv', () => {
    globalAny.__repodnaAjvV1 = null;
    const project = minimalProject();
    delete (project as Partial<RepoDNAProject>).routes;
    const result = validateRepoDNAProject(project);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('routes'))).toBe(true);
  });

  it('rejects non-false executedRepositoryCode even in the fallback path', () => {
    globalAny.__repodnaAjvV1 = null;
    const project = minimalProject();
    project.metadata.executedRepositoryCode = true as unknown as false; // invariant violation
    const result = validateRepoDNAProject(project);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('executedRepositoryCode'))).toBe(true);
  });

  it('never throws during module import or first use (hydration safety)', () => {
    // The historical bug: module-scope compile threw before React could mount.
    // Validation must be callable at any time without raising.
    expect(() => validateRepoDNAProject(null)).not.toThrow();
    expect(() => validateRepoDNAProject({})).not.toThrow();
    const empty = validateRepoDNAProject({});
    expect(empty.valid).toBe(false);
  });

  it('validates every v2 node instead of trusting records after the first 50', () => {
    globalAny.__repodnaAjvV2 = null;
    const project = makeV2Fixture();
    const template = project.nodes[0];
    project.nodes = Array.from({ length: 52 }, (_, index) => ({
      ...template,
      id: `node-${index}`,
      qualifiedName: `node-${index}`,
      kind: index === 51 ? 'not-a-real-kind' as never : template.kind,
    }));

    const result = validateRepoDNAProjectV2(project);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('nodes[51].kind is invalid');
  });

  it('rejects malformed edge evidence and out-of-range confidence in the CSP path', () => {
    globalAny.__repodnaAjvV2 = null;
    const project = makeV2Fixture();
    project.edges[0] = {
      ...project.edges[0],
      confidence: 4,
      evidence: { file: 'src/index.ts', range: { startLine: 0, startCol: -1, endLine: 0, endCol: -1 } },
    };

    const result = validateRepoDNAProjectV2(project);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('confidence'))).toBe(true);
    expect(result.errors.some((error) => error.includes('startLine'))).toBe(true);
  });

  it('rejects v2 relationships that point at missing graph nodes', () => {
    globalAny.__repodnaAjvV2 = null;
    const project = makeV2Fixture();
    project.edges[0] = { ...project.edges[0], target: 'missing-node' };

    const result = validateRepoDNAProjectV2(project);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('edges[0].target must reference an existing node');
  });

  it('bounds imported JSON before reading or parsing it', () => {
    expect(() => assertImportedArtifactSize(MAX_IMPORTED_ARTIFACT_BYTES)).not.toThrow();
    expect(() => assertImportedArtifactSize(MAX_IMPORTED_ARTIFACT_BYTES + 1)).toThrow(/128 MB/);
  });

  it('accepts every checked-in sample through the browser structural validator', () => {
    globalAny.__repodnaAjvV1 = null;
    globalAny.__repodnaAjvV2 = null;
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const paths = [
      join(root, 'public', 'demo-project.json'),
      ...readdirSync(join(root, 'public', 'samples'))
        .filter((name) => name.endsWith('.json'))
        .map((name) => join(root, 'public', 'samples', name)),
    ];

    for (const path of paths) {
      const artifact = JSON.parse(readFileSync(path, 'utf8')) as { schemaVersion?: string };
      const result = artifact.schemaVersion === '2.0.0'
        ? validateRepoDNAProjectV2(artifact)
        : validateRepoDNAProject(artifact);
      expect(result.errors, path).toEqual([]);
    }
  });
});

describe('v1→v2 adapter edge integrity', () => {
  it('normalizes import source/target to file: node IDs so edges resolve', async () => {
    const { adaptV1ToV2Viewer } = await import('../../app/lib/schema/artifact-loader');
    const { resolveImports } = await import('../../app/lib/analyzer/graph');

    const project = {
      schemaVersion: '1.1.0',
      generatedAt: '2026-01-01T00:00:00.000Z',
      repository: {
        name: 'x', source: 'https://github.com/x/x',
        languages: { Go: 100 }, fileCount: 2, sourceFileCount: 2, parsedFileCount: 2, lines: 20,
        fingerprint: {
          languages: [], frameworks: [], infrastructure: [], databases: [],
          externalSystems: [], testing: [], buildTools: [],
        },
      },
      technologies: [],
      files: [
        { id: 'file:main.go', path: 'main.go', language: 'Go', lines: 10, bytes: 100, hash: 'h1', role: 'source', parsed: true, error: null },
        { id: 'file:render/json.go', path: 'render/json.go', language: 'Go', lines: 10, bytes: 100, hash: 'h2', role: 'source', parsed: true, error: null },
      ],
      symbols: [], imports: [
        { id: 'i1', source: 'main.go', module: 'example.com/x/render', names: [], line: 3, target: null, external: false },
      ], calls: [], routes: [],
      databases: [], external_systems: [],
      entrypoints: [], flows: [],
      architecture: { components: [], connections: [] },
      important_files: [], onboarding: [],
      metrics: {
        complexityScore: 1, localDependencies: 0, externalDependencies: 0,
        dependencyCycles: [], mostConnectedFiles: [], highCouplingFiles: [],
        symbols: 0, routes: 0, components: 0, parseSuccessRate: 100,
      },
      diagnostics: [],
      metadata: {
        analysisMode: 'test', executedRepositoryCode: false,
        limits: { maxFiles: 10, maxFileBytes: 100 },
        fileComponents: {}, cache: { hits: 0, misses: 0 },
      },
    };

    resolveImports(project.imports as never, project.files as never);
    const v2 = adaptV1ToV2Viewer(project as never);

    expect(v2.edges).toHaveLength(1);
    const edge = v2.edges[0];
    expect(edge.source).toBe('file:main.go');
    expect(edge.target).toBe('file:render/json.go');
    expect(edge.status).toBe('resolved');
    // Every edge endpoint must reference an existing node ID.
    const nodeIds = new Set(v2.nodes.map((n) => n.id));
    expect(nodeIds.has(edge.source)).toBe(true);
    expect(nodeIds.has(edge.target ?? '')).toBe(true);
  });
});
