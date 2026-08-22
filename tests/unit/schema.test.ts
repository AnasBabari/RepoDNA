import { describe, expect, it } from 'vitest';
import { validateRepoDNAProject } from '../../app/lib/schema/validator';
import type { RepoDNAProject } from '../../app/lib/types';

function createMinimalValidProject(): RepoDNAProject {
  return {
    schemaVersion: '1.1.0',
    generatedAt: new Date().toISOString(),
    repository: {
      name: 'test-repo',
      source: 'github:owner/test-repo',
      languages: { TypeScript: 100 },
      fileCount: 1,
      sourceFileCount: 1,
      parsedFileCount: 1,
      lines: 50,
      fingerprint: {
        languages: ['TypeScript'],
        frameworks: ['Express'],
        infrastructure: [],
        databases: [],
        externalSystems: [],
        testing: [],
        buildTools: [],
      },
    },
    technologies: ['TypeScript', 'Express'],
    files: [
      {
        id: 'f1',
        path: 'src/index.ts',
        language: 'TypeScript',
        lines: 50,
        bytes: 1200,
        hash: 'abc1234',
        role: 'source',
        parsed: true,
        error: null,
      },
    ],
    symbols: [
      {
        id: 's1',
        type: 'function',
        name: 'handler',
        file: 'src/index.ts',
        line: 10,
        endLine: 20,
        parent: null,
        exported: true,
        evidence: ['exported function'],
      },
    ],
    imports: [],
    calls: [],
    routes: [
      {
        id: 'r1',
        method: 'GET',
        path: '/api/test',
        handler: 'handler',
        file: 'src/index.ts',
        line: 10,
        framework: 'Express',
        confidence: 0.95,
      },
    ],
    databases: [],
    externalSystems: [],
    external_systems: [],
    entrypoints: [
      {
        id: 'e1',
        file: 'src/index.ts',
        kind: 'main',
        score: 10,
        confidence: 0.9,
        evidence: ['entrypoint'],
      },
    ],
    flows: [],
    architecture: {
      components: [
        {
          id: 'c1',
          name: 'API',
          type: 'api',
          files: ['src/index.ts'],
          confidence: 0.9,
          evidence: ['routes'],
        },
      ],
      connections: [],
    },
    importantFiles: [],
    important_files: [],
    onboarding: [],
    metrics: {
      complexityScore: 12,
      localDependencies: 0,
      externalDependencies: 0,
      dependencyCycles: [],
      mostConnectedFiles: [],
      highCouplingFiles: [],
      symbols: 1,
      routes: 1,
      components: 1,
      parseSuccessRate: 94.7, // percentage 0-100
    },
    diagnostics: [],
    metadata: {
      analysisMode: 'static-typescript',
      executedRepositoryCode: false,
      analyzerVersion: '1.2.0',
      limits: {
        maxFiles: 10000,
        maxFileBytes: 1000000,
      },
      fileComponents: {},
      cache: { hits: 0, misses: 1 },
    },
  };
}

describe('Ajv Canonical Schema Invariant Tests', () => {
  it('validates a complete, structurally sound RepoDNAProject', () => {
    const project = createMinimalValidProject();
    const result = validateRepoDNAProject(project);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts realistic percentage parseSuccessRate between 0 and 100', () => {
    const project = createMinimalValidProject();
    project.metrics.parseSuccessRate = 98.5;
    expect(validateRepoDNAProject(project).valid).toBe(true);

    project.metrics.parseSuccessRate = 0;
    expect(validateRepoDNAProject(project).valid).toBe(true);

    project.metrics.parseSuccessRate = 100;
    expect(validateRepoDNAProject(project).valid).toBe(true);
  });

  it('strictly rejects parseSuccessRate exceeding 100 or below 0', () => {
    const project = createMinimalValidProject();
    project.metrics.parseSuccessRate = 105;
    const overResult = validateRepoDNAProject(project);
    expect(overResult.valid).toBe(false);
    expect(overResult.errors.some((e) => e.includes('must be <= 100'))).toBe(true);

    project.metrics.parseSuccessRate = -1;
    const underResult = validateRepoDNAProject(project);
    expect(underResult.valid).toBe(false);
    expect(underResult.errors.some((e) => e.includes('must be >= 0'))).toBe(true);
  });

  it('strictly rejects missing required top-level collections', () => {
    const project = createMinimalValidProject();
    delete (project as Partial<RepoDNAProject>).routes;
    const result = validateRepoDNAProject(project);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("must have required property 'routes'"))).toBe(true);
  });

  it('strictly rejects invalid symbol records', () => {
    const project = createMinimalValidProject();
    project.symbols[0].line = 0; // minimum is 1
    const result = validateRepoDNAProject(project);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('must be >= 1'))).toBe(true);
  });
});
