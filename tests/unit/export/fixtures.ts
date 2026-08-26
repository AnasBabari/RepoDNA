import type {
  GraphEdge,
  GraphEdgeStatus,
  GraphEdgeType,
  GraphNode,
  GraphNodeKind,
  RepoDNAProjectV2,
  SourceRange,
} from '../../../app/lib/analyzer/v2/types';

const RANGE: SourceRange = { startLine: 1, startCol: 0, endLine: 2, endCol: 0 };

export function mkNode(
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
    evidence: overrides.evidence,
    confidence: overrides.confidence ?? 1,
    metadata: overrides.metadata,
  };
}

export function mkEdge(
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
    confidence: overrides.confidence ?? 0.9,
    evidence: overrides.evidence ?? { file: 'src/a.py', range: { ...RANGE } },
    explanation: overrides.explanation ?? `${source} ${type} ${target ?? 'unknown'}`,
    resolver: overrides.resolver ?? { name: 'test-resolver', version: '1.0.0' },
    alternativeCandidates: overrides.alternativeCandidates,
    unresolvedExpression: overrides.unresolvedExpression,
    metadata: overrides.metadata,
  };
}

export function makeV2Fixture(overrides: Partial<RepoDNAProjectV2> = {}): RepoDNAProjectV2 {
  const nodes: GraphNode[] = [
    mkNode('n-file-a', 'file', 'a.py', 'src/a.py'),
    mkNode('n-file-b', 'file', 'b.py', 'src/b.py'),
    mkNode('n-class-c', 'class', 'Config', 'src/a.py'),
    mkNode('n-func-f', 'function', 'fetch_data', 'src/b.py'),
    mkNode('n-dep-req', 'dependency', 'requests', '', { language: 'External' }),
    mkNode('n-route-r', 'route', 'GET /items', 'src/b.py'),
  ];
  const edges: GraphEdge[] = [
    mkEdge('e-defines', 'n-file-a', 'n-class-c', 'DEFINES', 'extracted', {
      explanation: 'src/a.py defines class Config',
    }),
    mkEdge('e-imports', 'n-file-a', 'n-file-b', 'IMPORTS', 'resolved', {
      explanation: 'Import b resolves to src/b.py',
    }),
    mkEdge('e-calls', 'n-func-f', null, 'CALLS', 'unresolved', {
      confidence: 0.4,
      explanation: 'fetch_data calls unresolved expression mystery()',
      unresolvedExpression: 'mystery()',
      alternativeCandidates: ['n-class-c'],
    }),
    mkEdge('e-ambig', 'n-func-f', null, 'CALLS', 'ambiguous', {
      confidence: 0.5,
      explanation: 'fetch_data call helper() matches multiple definitions',
      unresolvedExpression: 'helper()',
      alternativeCandidates: ['n-class-c', 'n-file-a'],
    }),
    mkEdge('e-depends', 'n-file-a', 'n-dep-req', 'DEPENDS_ON', 'resolved', {
      explanation: 'src/a.py depends on external package requests',
    }),
    mkEdge('e-exposes', 'n-file-b', 'n-route-r', 'EXPOSES_ROUTE', 'extracted', {
      explanation: 'src/b.py exposes GET /items',
    }),
  ];

  return {
    schemaVersion: '2.0.0',
    generatedAt: '2026-01-02T03:04:05.000Z',
    repository: {
      name: 'fixture-repo',
      source: 'https://github.com/example/fixture-repo',
      commitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      analyzedRef: 'main',
      languages: { Python: 100 },
      fingerprint: {
        languages: ['Python'],
        frameworks: [],
        infrastructure: [],
        databases: [],
        externalSystems: [],
        testing: [],
        buildTools: [],
        tooling: [],
        languageFileCounts: { Python: 2 },
      },
    },
    inventory: {
      totalFileCount: 2,
      totalBytes: 2048,
      firstPartySourceFileCount: 2,
      firstPartyLoc: 120,
      candidateFileCount: 2,
      parsedFileCount: 2,
      partiallyParsedFileCount: 0,
      failedFileCount: 0,
      unsupportedSourceFileCount: 0,
      ignoredFileCount: 0,
      generatedFileCount: 0,
      packageCount: 1,
      declaredDependencyCount: 1,
      skippedByReason: {},
      languageCoverage: { Python: 2 },
    },
    coverage: { percentage: 100, parsed: 2, partial: 0, unsupported: 0, ignored: 0, skipped: 0, truncationReasons: [] },
    nodes,
    edges,
    architecture: {
      components: [
        {
          id: 'comp-api',
          name: 'API Layer',
          type: 'api',
          files: ['src/a.py'],
          confidence: 0.9,
          evidence: ['route decorators found'],
        },
      ],
      connections: [],
    },
    flows: [],
    communities: [{ id: '0', members: ['n-file-a', 'n-file-b'], label: 'core', cohesion: 0.8 }],
    dependencyCycles: [],
    centrality: { mostConnected: [], highCoupling: [], godNodes: [] },
    unresolved: [{ edgeId: 'e-calls', reason: 'unresolved call', candidates: ['n-class-c'] }],
    diagnostics: [],
    timings: { stages: {}, totalMs: 10 },
    parsers: { versions: {}, mode: 'tree-sitter' },
    security: { limits: {}, truncated: [], executedRepositoryCode: false },
    completeness: { status: 'FULLY_MAPPED', reasons: [] },
    metadata: { analyzerVersion: '2.0.0' },
    ...overrides,
  };
}

export const NASTY_STRINGS = {
  commaQuote: 'value, with "quotes" and, commas',
  multiline: 'first line\nsecond line\r\nthird line',
  unicode: 'emoji 🚀 séparé U+2028\u2028U+2029\u2029 end',
  formulaEquals: '=cmd|"/c calc"!A1',
  formulaPlus: '+SUM(A1:A9)',
  formulaMinus: '-2+3+cmd',
  formulaAt: '@SUM(A1)',
  formulaTab: '\t=1+2',
  cypherBreakout: "'}) DETACH DELETE (n) RETURN ({x:'",
  newlineInjection: "line'\nMATCH (n) DETACH DELETE n //",
  controlBytes: 'nul\u0000bell\u0007esc\u001b',
  backslashes: 'C:\\Users\\test\\file "quoted" \\\' end',
  punctuationOnly: '!!!???***',
  huge: 'x'.repeat(2000),
} as const;

export function makeSecurityFixture(): RepoDNAProjectV2 {
  const base = makeV2Fixture();
  const nodes = [
    mkNode('s-file-a', 'file', NASTY_STRINGS.commaQuote, 'src/=weird,name".py', {
      metadata: { note: NASTY_STRINGS.huge, breakout: NASTY_STRINGS.cypherBreakout },
    }),
    mkNode('s-file-b', 'file', NASTY_STRINGS.punctuationOnly, 'src/\u2028line\u2029sep.py', {
      metadata: { multiline: NASTY_STRINGS.multiline },
    }),
    mkNode('s-func', 'function', NASTY_STRINGS.formulaEquals, 'src/=weird,name".py', {
      qualifiedName: NASTY_STRINGS.newlineInjection,
      metadata: { control: NASTY_STRINGS.controlBytes },
    }),
    mkNode('s-dep', 'dependency', NASTY_STRINGS.formulaAt, '', { language: 'External' }),
  ];
  const edges = [
    mkEdge('se-defines', 's-file-a', 's-func', 'DEFINES', 'extracted', {
      explanation: NASTY_STRINGS.multiline,
      evidence: { file: 'src/=weird,name".py', range: { startLine: 1, startCol: 0, endLine: 1, endCol: 0 } },
      metadata: { formula: NASTY_STRINGS.formulaPlus, tab: NASTY_STRINGS.formulaTab },
    }),
    mkEdge('se-imports', 's-file-a', 's-file-b', 'IMPORTS', 'resolved', {
      explanation: NASTY_STRINGS.cypherBreakout,
    }),
    mkEdge('se-calls', 's-func', null, 'CALLS', 'unresolved', {
      explanation: NASTY_STRINGS.unicode,
      unresolvedExpression: NASTY_STRINGS.newlineInjection,
      alternativeCandidates: ['s-file-b'],
    }),
    mkEdge('se-depends', 's-file-a', 's-dep', 'DEPENDS_ON', 'resolved', {
      explanation: NASTY_STRINGS.formulaMinus,
    }),
  ];
  return {
    ...base,
    repository: {
      ...base.repository,
      name: 'repo with "quotes" & spaces\u0000',
      commitSha: null,
    },
    nodes,
    edges,
    communities: [{ id: 'grp', members: ['s-file-a', 's-file-b'], label: NASTY_STRINGS.cypherBreakout, cohesion: 0.5 }],
    architecture: {
      components: [
        {
          id: 'comp"weird\'',
          name: NASTY_STRINGS.newlineInjection,
          type: 'api',
          files: ['src/=weird,name".py'],
          confidence: 0.7,
          evidence: [NASTY_STRINGS.multiline],
        },
      ],
      connections: [],
    },
    unresolved: [{ edgeId: 'se-calls', reason: NASTY_STRINGS.multiline, candidates: ['s-file-b'] }],
  };
}

export function makeSyntheticFixture(nodeCount: number, edgeCount: number): RepoDNAProjectV2 {
  const base = makeV2Fixture();
  const nodes: GraphNode[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const id = `syn-node-${String(i).padStart(6, '0')}`;
    nodes.push(mkNode(id, i % 5 === 0 ? 'file' : 'function', `entity_${i}`, `src/mod_${i % 97}.py`));
  }
  const edges: GraphEdge[] = [];
  for (let i = 0; i < edgeCount; i++) {
    const source = nodes[i % nodeCount].id;
    const unresolved = i % 41 === 0;
    const target = unresolved ? null : nodes[(i * 7 + 1) % nodeCount].id;
    edges.push(
      mkEdge(`syn-edge-${String(i).padStart(6, '0')}`, source, target, i % 3 === 0 ? 'CALLS' : 'IMPORTS', unresolved ? 'unresolved' : 'resolved', {
        explanation: `synthetic relationship ${i}`,
        unresolvedExpression: unresolved ? `expr_${i}()` : undefined,
      })
    );
  }
  return {
    ...base,
    nodes,
    edges,
    communities: [
      { id: 'syn-0', members: nodes.slice(0, Math.min(50, nodeCount)).map((n) => n.id), label: 'synthetic', cohesion: 0.4 },
    ],
    architecture: { components: [], connections: [] },
    unresolved: [],
  };
}
