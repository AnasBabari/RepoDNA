import { describe, expect, it } from 'vitest';
import { generateTextReport } from '../../app/lib/export/text-report';
import type { RepoDNAProject } from '../../app/lib/types';
import type { RepoDNAProjectV2 } from '../../app/lib/analyzer/v2/types';
import fs from 'node:fs';
import path from 'node:path';

const FIXED_TS = '2026-01-01T00:00:00.000Z';

function makeV1Project(): RepoDNAProject {
  return {
    schemaVersion: '1.1.0',
    generatedAt: FIXED_TS,
    repository: {
      name: 'fixture-repo',
      source: 'https://github.com/example/fixture-repo',
      languages: { Python: 12, Go: 4 },
      fileCount: 40,
      sourceFileCount: 30,
      parsedFileCount: 28,
      lines: 9000,
      fingerprint: {
        languages: ['python', 'go'],
        frameworks: ['FastAPI'],
        infrastructure: ['Docker'],
        databases: ['PostgreSQL'],
        externalSystems: [],
        testing: ['pytest'],
        buildTools: ['pip'],
      },
    },
    technologies: ['Redis'],
    files: [
      {
        id: 'f1', path: 'main.py', language: 'Python', lines: 120, bytes: 4000,
        hash: 'abc', role: 'entrypoint', parsed: true, error: null,
      },
      {
        id: 'f2', path: 'broken.py', language: 'Python', lines: 10, bytes: 300,
        hash: 'def', role: 'module', parsed: false, error: 'syntax error at line 3',
      },
    ],
    symbols: [
      {
        id: 's1', type: 'class', name: 'UserService', file: 'services/user.py',
        line: 5, endLine: 80, parent: null, exported: true, evidence: [],
      },
      {
        id: 's2', type: 'function', name: 'get_user', file: 'api/users.py',
        line: 12, endLine: 20, parent: null, exported: true, evidence: [],
      },
    ],
    imports: [],
    calls: [],
    routes: [
      {
        id: 'r1', method: 'GET', path: '/users/{id}', handler: 'get_user',
        file: 'api/users.py', line: 12, framework: 'FastAPI', confidence: 0.95,
      },
    ],
    databases: [{ name: 'PostgreSQL', type: 'database', confidence: 0.9, evidence: [] }],
    externalSystems: [{ name: 'Stripe API', type: 'external_system', confidence: 0.8, evidence: [] }],
    external_systems: [{ name: 'Stripe API', type: 'external_system', confidence: 0.8, evidence: [] }],
    entrypoints: [
      { id: 'e1', file: 'main.py', kind: 'cli', score: 0.9, confidence: 0.9, evidence: [] },
    ],
    flows: [
      {
        id: 'flow1', name: 'Get user flow', confidence: 0.9,
        nodes: [
          { id: 'n1', type: 'route', label: 'GET /users/{id}', file: 'api/users.py', line: 12 },
          { id: 'n2', type: 'handler', label: 'get_user', file: 'api/users.py', line: 12 },
        ],
        edges: [{ source: 'n1', target: 'n2', type: 'HANDLES' }],
      },
    ],
    architecture: {
      components: [
        { id: 'c1', name: 'API Layer', type: 'layer', files: ['api/users.py'], confidence: 0.85, evidence: [] },
      ],
      connections: [],
    },
    importantFiles: [{ file: 'main.py', score: 0.95, reasons: ['entrypoint'] }],
    onboarding: [],
    metrics: {
      complexityScore: 42,
      localDependencies: 6,
      externalDependencies: 15,
      dependencyCycles: [['a.py', 'b.py']],
      mostConnectedFiles: [{ file: 'main.py', connections: 8 }],
      highCouplingFiles: [{ file: 'core.py', connections: 11 }],
      symbols: 220,
      routes: 1,
      components: 1,
      parseSuccessRate: 93,
    },
    diagnostics: [
      { severity: 'warning', code: 'PARSE_FAILED', message: '1 file failed to parse', file: 'broken.py' },
    ],
    metadata: {
      analysisMode: 'deep',
      executedRepositoryCode: false,
      analyzerVersion: '1.1.0-test',
      limits: { maxFiles: 10000, maxFileBytes: 1000000 },
      fileComponents: {},
      cache: { hits: 0, misses: 0 },
    },
  };
}

function makeV2Project(): RepoDNAProjectV2 {
  return {
    schemaVersion: '2.0.0',
    generatedAt: FIXED_TS,
    repository: {
      name: 'fixture-v2',
      source: 'https://github.com/example/fixture-v2',
      commitSha: 'deadbeef1234567890',
      analyzedRef: 'refs/heads/main',
      languages: { TypeScript: 20 },
      fingerprint: {
        languages: ['typescript'], frameworks: [], infrastructure: [],
        databases: [], externalSystems: [], testing: [], buildTools: [],
        languageFileCounts: { typescript: 20 },
      },
    },
    inventory: {
      totalFileCount: 55,
      totalBytes: 240000,
      firstPartySourceFileCount: 25,
      firstPartyLoc: 7000,
      candidateFileCount: 30,
      parsedFileCount: 25,
      partiallyParsedFileCount: 0,
      failedFileCount: 0,
      unsupportedSourceFileCount: 3,
      ignoredFileCount: 18,
      generatedFileCount: 2,
      packageCount: 1,
      declaredDependencyCount: 42,
      skippedByReason: { too_large: 2 },
      languageCoverage: { typescript: 25 },
    },
    coverage: { percentage: 100, parsed: 25, partial: 0, unsupported: 3, ignored: 18, skipped: 2, truncationReasons: [] },
    nodes: [
      {
        id: 'node_aaa', kind: 'repository', name: 'fixture-v2', qualifiedName: 'fixture-v2',
        path: '', language: '', range: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      },
      {
        id: 'node_bbb', kind: 'data_model', name: 'User', qualifiedName: 'models.User',
        path: 'src/models.ts', language: 'typescript', range: { startLine: 4, startCol: 1, endLine: 20, endCol: 2 },
      },
      {
        id: 'node_ccc', kind: 'function', name: 'readUser', qualifiedName: 'db.readUser',
        path: 'src/db.ts', language: 'typescript', range: { startLine: 10, startCol: 1, endLine: 15, endCol: 2 },
      },
    ],
    edges: [
      {
        id: 'edge_ddd', source: 'node_ccc', target: 'node_bbb', type: 'READS',
        status: 'resolved', confidence: 0.9,
        evidence: { file: 'src/db.ts', range: { startLine: 12, startCol: 3, endLine: 12, endCol: 20 } },
        explanation: 'ORM select call resolves to models.User', resolver: { name: 'orm-resolver', version: '1' },
      },
      {
        id: 'edge_eee', source: 'node_ccc', target: null, type: 'CALLS',
        status: 'unresolved', confidence: 0.3,
        evidence: { file: 'src/db.ts', range: { startLine: 13, startCol: 3, endLine: 13, endCol: 25 } },
        explanation: 'Dynamic expression could not be resolved', resolver: { name: 'call-resolver', version: '1' },
        unresolvedExpression: 'registry[name]()',
        alternativeCandidates: ['node_bbb'],
      },
    ],
    architecture: { components: [], connections: [] },
    flows: [],
    communities: [{ id: 'community:0', members: ['node_aaa', 'node_bbb'], label: 'Community 1 (2 nodes)', cohesion: 1 }],
    dependencyCycles: [['src/a.ts', 'src/b.ts']],
    centrality: {
      mostConnected: [{ nodeId: 'node_ccc', inDegree: 3, outDegree: 2, score: 5 }],
      highCoupling: [{ nodeId: 'node_ccc', connections: 5 }],
      godNodes: [{ nodeId: 'node_ccc', reason: 'fan-in and fan-out both exceed threshold' }],
    },
    unresolved: [{ edgeId: 'edge_eee', reason: 'Dynamic expression could not be resolved', candidates: ['node_bbb'] }],
    diagnostics: [],
    timings: { stages: { parse: 120 }, totalMs: 500 },
    parsers: { versions: { 'tree-sitter': '0.26.12' }, mode: 'tree-sitter' },
    security: { limits: { maxFiles: 10000 }, truncated: [], executedRepositoryCode: false },
    completeness: { status: 'MOSTLY_MAPPED', reasons: ['unresolved relationships'] },
    metadata: { analyzerVersion: '2.0.0-test' },
  };
}

describe('generateTextReport', () => {
  const requiredSections = [
    'Repository identity', 'Analysis metadata', 'Safety statement', 'Repository inventory',
    'Size classification', 'Scan coverage and limitations', 'Languages', 'Packages and workspaces',
    'Frameworks and infrastructure', 'Declared dependencies', 'Architecture areas', 'Entrypoints',
    'Routes and handlers', 'Execution paths', 'Modules', 'Symbols', 'Data models and tables',
    'Data reads and writes', 'External systems', 'Dependency communities', 'Dependency cycles',
    'Central and high-coupling nodes', 'Blast radius findings', 'Unresolved and ambiguous relationships',
    'Unsupported, skipped, partial, and failed files', 'Stage timings and limits',
  ];

  it('renders every required section for a v1 artifact', () => {
    const report = generateTextReport(makeV1Project(), { generatedAt: FIXED_TS });
    for (const section of requiredSections) {
      expect(report).toContain(section);
    }
  });

  it('is deterministic for identical input', () => {
    const a = generateTextReport(makeV1Project(), { generatedAt: FIXED_TS });
    const b = generateTextReport(makeV1Project(), { generatedAt: FIXED_TS });
    expect(a).toBe(b);
  });

  it('states the zero-execution guarantee for v1 artifacts', () => {
    const report = generateTextReport(makeV1Project());
    expect(report).toContain('Zero execution guarantee');
  });

  it('reports failed parses honestly', () => {
    const report = generateTextReport(makeV1Project());
    expect(report).toContain('Failed parses (1)');
    expect(report).toContain('broken.py');
    expect(report).toContain('syntax error at line 3');
  });

  it('loads the committed strix v1.1 sample without throwing and includes identity', () => {
    const samplePath = path.join(__dirname, '..', '..', 'public', 'samples', 'strix.json');
    if (!fs.existsSync(samplePath)) return; // sample regeneration is environment-dependent
    const raw = JSON.parse(fs.readFileSync(samplePath, 'utf-8')) as RepoDNAProject;
    const report = generateTextReport(raw, { generatedAt: FIXED_TS });
    expect(report).toContain('strix');
    for (const section of requiredSections) {
      expect(report).toContain(section);
    }
  });

  it('renders v2 inventory, completeness, evidence, and unresolved detail', () => {
    const report = generateTextReport(makeV2Project(), { generatedAt: FIXED_TS });
    expect(report).toContain('Analyzed commit: deadbeef1234567890');
    expect(report).toContain('First-party source files:  25');
    expect(report).toContain('Completeness: MOSTLY_MAPPED');
    expect(report).toContain('unresolved relationships');
    expect(report).toContain('Dynamic expression could not be resolved');
    expect(report).toContain('expression="registry[name]()"');
    expect(report).toContain('candidate: node_bbb');
    expect(report).toContain('READS');
    expect(report).toContain('GOD NODE');
    expect(report).toContain('tree-sitter');
  });

  it('classifies sizes by the largest triggered threshold', () => {
    const p = makeV1Project();
    p.repository.sourceFileCount = 1200;
    expect(generateTextReport(p)).toContain('Very large');
    p.repository.sourceFileCount = 300;
    expect(generateTextReport(p)).toContain('Large');
    p.repository.sourceFileCount = 60;
    expect(generateTextReport(p)).toContain('Medium');
    p.repository.sourceFileCount = 10;
    p.repository.lines = 15000;
    expect(generateTextReport(p)).toContain('Medium');
    p.repository.lines = 100;
    expect(generateTextReport(p)).toContain('Small');
  });

  it('truncates long lists with totals instead of omitting silently', () => {
    const p = makeV1Project();
    p.routes = Array.from({ length: 60 }, (_, i) => ({
      id: `r${i}`, method: 'GET', path: `/p${i}`, handler: `h${i}`,
      file: `f${i}.py`, line: i + 1, framework: 'FastAPI', confidence: 0.9,
    }));
    const report = generateTextReport(p);
    expect(report).toMatch(/showing 25 of 60 entries/);
  });
});
