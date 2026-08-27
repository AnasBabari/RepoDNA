/**
 * Canonical RepoDNA v2 fixtures for deterministic graph-export E2E runs.
 *
 * The fixture is hand-built to satisfy:
 *   - matchesProjectV2 structural gate in RepoWorkspace,
 *   - assertArchitectureConsistency applied to projectV2ForWorkspace(fixture),
 *   - graph export normalization (sorted ids, resolvable references),
 *   - byte-deterministic exports (fixed generatedAt, stable ids).
 */
import type {
  GraphEdge,
  GraphEdgeStatus,
  GraphEdgeType,
  GraphNode,
  GraphNodeKind,
  RepoDNAProjectV2,
  SourceRange,
} from '../../app/lib/analyzer/v2/types';

export const FIXTURE_COMMIT_SHA = '1234567890abcdef1234567890abcdef12345678';
export const FIXTURE_GENERATED_AT = '2026-01-02T03:04:05.000Z';
/** Cell value starting with '=' must get an apostrophe prefix in CSV cells. */
export const FORMULA_HOSTILE_NAME = '=IMPORTXML';

const RANGE: SourceRange = { startLine: 1, startCol: 0, endLine: 10, endCol: 0 };

function mkNode(
  id: string,
  kind: GraphNodeKind,
  name: string,
  path: string,
  overrides: Partial<GraphNode> = {}
): GraphNode {
  return {
    id,
    kind,
    name,
    qualifiedName: overrides.qualifiedName ?? `${path}:${name}`,
    path,
    language: overrides.language ?? 'Python',
    range: overrides.range ?? { ...RANGE },
    confidence: overrides.confidence ?? 1,
    evidence: overrides.evidence,
    metadata: overrides.metadata,
  };
}

function mkEdge(
  id: string,
  source: string,
  target: string | null,
  type: GraphEdgeType,
  status: GraphEdgeStatus,
  overrides: Partial<GraphEdge> = {}
): GraphEdge {
  return {
    id,
    source,
    target,
    type,
    status,
    confidence: overrides.confidence ?? 0.92,
    evidence: overrides.evidence ?? { file: 'src/a.py', range: { startLine: 1, startCol: 0, endLine: 4, endCol: 0 } },
    explanation: overrides.explanation ?? `${source} ${type} ${target ?? 'unresolved call target'}`,
    resolver: overrides.resolver ?? { name: 'e2e-resolver', version: '1.0.0' },
    alternativeCandidates: overrides.alternativeCandidates,
    unresolvedExpression: overrides.unresolvedExpression,
    metadata: overrides.metadata,
  };
}

/** Small hand-verifiable canonical artifact (default demo for most tests). */
export function buildCanonicalProjectV2(): RepoDNAProjectV2 {
  const nodes: GraphNode[] = [
    mkNode('n-fa', 'file', 'a.py', 'src/a.py'),
    mkNode('n-fb', 'file', 'b.py', 'src/b.py'),
    mkNode('n-fm', 'file', 'models.py', 'src/models.py'),
    mkNode('n-class', 'class', 'Settings', 'src/a.py'),
    mkNode('n-fn', 'function', 'load_settings', 'src/a.py'),
    mkNode('n-route', 'route', 'GET /items', 'src/b.py'),
    // Formula-hostile name exercises CSV injection protection end-to-end.
    mkNode('n-formula', 'function', FORMULA_HOSTILE_NAME, 'src/b.py', {
      qualifiedName: 'src/b.py:=IMPORTXML',
      metadata: { note: '@SUMevil' },
    }),
    mkNode('n-dep', 'dependency', 'fastapi', '', { language: 'External' }),
  ];

  const edges: GraphEdge[] = [
    mkEdge('e-defines-class', 'n-fa', 'n-class', 'DEFINES', 'extracted', {
      explanation: 'src/a.py defines class Settings',
    }),
    mkEdge('e-imports-ab', 'n-fb', 'n-fa', 'IMPORTS', 'resolved', {
      explanation: 'Import of settings module resolves to src/a.py',
    }),
    mkEdge('e-depends-fastapi', 'n-fa', 'n-dep', 'DEPENDS_ON', 'resolved', {
      explanation: 'src/a.py depends on external package fastapi',
    }),
    mkEdge('e-exposes-route', 'n-fb', 'n-route', 'EXPOSES_ROUTE', 'extracted', {
      explanation: 'src/b.py exposes GET /items',
    }),
    mkEdge('e-call-unresolved', 'n-fn', null, 'CALLS', 'unresolved', {
      confidence: 0.35,
      explanation: 'load_settings calls mystery_helper() which cannot be resolved',
      unresolvedExpression: 'mystery_helper()',
      alternativeCandidates: ['n-class'],
    }),
    mkEdge('e-call-ambiguous', 'n-formula', null, 'CALLS', 'ambiguous', {
      confidence: 0.5,
      explanation: `${FORMULA_HOSTILE_NAME} call helper() matches multiple definitions`,
      unresolvedExpression: 'helper()',
      alternativeCandidates: ['n-class', 'n-fn'],
    }),
  ];

  return {
    schemaVersion: '2.0.0',
    generatedAt: FIXTURE_GENERATED_AT,


    repository: {
      name: 'export-lab',
      source: 'https://github.com/e2e-fixtures/export-lab',
      commitSha: FIXTURE_COMMIT_SHA,
      analyzedRef: 'main',
      languages: { Python: 100 },
      fingerprint: {
        languages: ['Python'],
        frameworks: ['FastAPI'],
        infrastructure: [],
        databases: [],
        buildTools: ['pip'],
        testing: ['pytest'],
        externalSystems: [],
        languageFileCounts: { Python: 3 },
      },
    },
    inventory: {
      totalFileCount: 3,
      totalBytes: 512,
      firstPartySourceFileCount: 3,
      firstPartyLoc: 60,
      candidateFileCount: 3,
      parsedFileCount: 3,
      partiallyParsedFileCount: 0,
      failedFileCount: 0,
      unsupportedSourceFileCount: 0,
      ignoredFileCount: 0,
      generatedFileCount: 0,
      packageCount: 1,
      declaredDependencyCount: 1,
      skippedByReason: {},
      languageCoverage: { Python: 3 },
    },
    coverage: { percentage: 100, parsed: 3, partial: 0, unsupported: 0, ignored: 0, skipped: 0, truncationReasons: [] },
    nodes,
    edges,
    architecture: {
      components: [
        {
          id: 'comp-api',
          name: 'API layer',
          type: 'api',
          files: ['src/a.py', 'src/b.py'],
          confidence: 0.9,
          evidence: ['FastAPI routes registered'],
        },
        {
          id: 'comp-models',
          name: 'Domain models',
          type: 'data',
          files: ['src/models.py'],
          confidence: 0.85,
          evidence: ['pydantic models detected'],
        },
      ],
      connections: [],
    },
    flows: [],
    communities: [
      { id: 'community-core', members: ['n-fa', 'n-fb', 'n-class'], label: 'core settings cluster', cohesion: 0.8 },
    ],

    dependencyCycles: [],
    centrality: {
      mostConnected: [{ nodeId: 'n-fa', inDegree: 3, outDegree: 2, score: 12 }],
      highCoupling: [{ nodeId: 'n-fa', connections: 5 }],
      godNodes: [],
    },
    unresolved: [
      { edgeId: 'e-call-unresolved', reason: 'call expression could not be matched', candidates: ['n-class'] },
      { edgeId: 'e-call-ambiguous', reason: 'multiple definition candidates', candidates: ['n-class', 'n-fn'] },
    ],
    diagnostics: [],
    timings: { stages: {}, totalMs: 42 },
    parsers: { versions: {}, mode: 'tree-sitter' },
    security: {
      limits: {
        maxFiles: 10_000,
        maxFileBytes: 1_000_000,
        maxArchiveBytes: 52_428_800,
        maxTotalExtractedBytes: 52_428_800,
      },
      truncated: [],
      executedRepositoryCode: false,
    },
    completeness: { status: 'FULLY_MAPPED', reasons: [] },
    entrypoints: [
      {
        id: 'ep-b',
        kind: 'module',
        file: 'src/b.py',
        score: 0.9,
        confidence: 0.9,
        evidence: ['contains FastAPI app instance'],
      },
    ],
    databases: [],
    externalSystems: [],
    external_systems: [],
    metadata: {
      analyzerVersion: 'e2e-fixture-1.0.0',
      analysisMode: 'canonical-graph-projection',
      cache: { hits: 0, misses: 1 },
    },
  };
}


interface LargeGraphOptions {
  nodeCount: number;
  edgesPerNode: number;
}

/**
 * Deterministic large synthetic canonical artifact used to stretch the export
 * worker long enough to observe live progress, interactivity, and cancellation.
 */
export function buildLargeCanonicalProject({ nodeCount, edgesPerNode }: LargeGraphOptions): RepoDNAProjectV2 {
  const base = buildCanonicalProjectV2();
  const nodes: GraphNode[] = [];
  const fileCount = Math.max(4, Math.floor(nodeCount / 25));
  for (let i = 0; i < fileCount; i++) {
    nodes.push(mkNode(`syn-f-${pad(i)}`, 'file', `mod_${i}.py`, `src/pkg/mod_${i}.py`));
  }
  for (let i = fileCount; i < nodeCount; i++) {
    const hostIndex = i % fileCount;
    nodes.push(
      mkNode(`syn-s-${pad(i)}`, i % 2 === 0 ? 'function' : 'class', `symbol_${i}`, `src/pkg/mod_${hostIndex}.py`)
    );
  }

  const edges: GraphEdge[] = [];
  for (let i = 0; i < nodeCount * edgesPerNode; i++) {
    const sourceIndex = (i * 7 + 3) % nodeCount;
    const isUnresolved = i % 11 === 0;
    const targetIndex = (i * 13 + 5) % nodeCount;
    const edgeId = `syn-e-${pad(i)}`;
    if (isUnresolved) {
      edges.push(
        mkEdge(edgeId, nodes[sourceIndex].id, null, 'CALLS', 'unresolved', {
          confidence: 0.3 + ((i % 10) / 100),
          explanation: `synthetic unresolved call ${i}`,
          unresolvedExpression: `dynamic_call_${i}()`,
          alternativeCandidates: [nodes[targetIndex].id],
        })
      );
    } else {
      edges.push(
        mkEdge(edgeId, nodes[sourceIndex].id, nodes[targetIndex].id, i % 3 === 0 ? 'IMPORTS' : 'CALLS', 'resolved', {
          confidence: 0.8 + ((i % 15) / 100),
          explanation: `synthetic relationship ${i}`,
        })
      );
    }
  }

  return {
    ...base,
    repository: { ...base.repository, name: 'export-lab-large' },
    generatedAt: FIXTURE_GENERATED_AT,
    nodes,
    edges,
    unresolved: edges
      .filter((edge) => edge.status === 'unresolved')
      .map((edge) => ({ edgeId: edge.id, reason: 'synthetic unresolved', candidates: edge.alternativeCandidates ?? [] })),
    coverage: {
      percentage: 100,
      parsed: fileCount,
      partial: 0,
      unsupported: 0,
      ignored: 0,
      skipped: 0,
      truncationReasons: [],
    },
  };
}

function pad(value: number): string {
  return String(value).padStart(6, '0');
}
