import type {
  ArchitectureComponent,
  ArchitectureConnection,
  Diagnostic,
  EntrypointRecord,
  FlowRecord,
  TechnologyBoundary,
} from '../../types';

export type GraphNodeKind =
  | 'repository'
  | 'workspace'
  | 'package'
  | 'directory'
  | 'module'
  | 'file'
  | 'class'
  | 'interface'
  | 'function'
  | 'method'
  | 'attribute'
  | 'variable'
  | 'route'
  | 'controller'
  | 'service'
  | 'repository_layer'
  | 'component'
  | 'data_model'
  | 'table'
  | 'dependency'
  | 'configuration'
  | 'external_system';

export type GraphEdgeType =
  | 'CONTAINS'
  | 'DEFINES'
  | 'IMPORTS'
  | 'CALLS'
  | 'INHERITS'
  | 'IMPLEMENTS'
  | 'READS'
  | 'WRITES'
  | 'EXPOSES_ROUTE'
  | 'HANDLES'
  | 'INVOKES'
  | 'DEPENDS_ON'
  | 'CONFIGURES';

export type GraphEdgeStatus = 'extracted' | 'resolved' | 'inferred' | 'ambiguous' | 'unresolved';

export interface SourceRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  name: string;
  qualifiedName: string;
  path: string;
  language: string;
  range: SourceRange;
  evidence?: string[];
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string | null;
  type: GraphEdgeType;
  status: GraphEdgeStatus;
  confidence: number;
  evidence: { file: string; range: SourceRange };
  explanation: string;
  resolver: { name: string; version: string };
  alternativeCandidates?: string[];
  unresolvedExpression?: string | null;
}

export interface Inventory {
  totalFileCount: number;
  totalBytes: number;
  firstPartySourceFileCount: number;
  firstPartyLoc: number;
  candidateFileCount: number;
  parsedFileCount: number;
  partiallyParsedFileCount: number;
  failedFileCount: number;
  unsupportedSourceFileCount: number;
  ignoredFileCount: number;
  generatedFileCount: number;
  packageCount: number;
  declaredDependencyCount: number;
  skippedByReason: Record<string, number>;
  languageCoverage: Record<string, number>;
  truncation?: {
    hitLimits: string[];
    maxFilesReached: boolean;
    maxBytesReached: boolean;
  };
}

export interface Coverage {
  percentage: number;
  parsed: number;
  partial: number;
  unsupported: number;
  ignored: number;
  skipped: number;
  truncationReasons: string[];
}

export interface Community {
  id: string;
  members: string[];
  label: string;
  cohesion: number;
}

export interface Centrality {
  mostConnected: { nodeId: string; inDegree: number; outDegree: number; score: number }[];
  highCoupling: { nodeId: string; connections: number }[];
  godNodes: { nodeId: string; reason: string }[];
}

export interface Unresolved {
  edgeId: string;
  reason: string;
  candidates: string[];
}

export interface Timings {
  stages: Record<string, number>;
  totalMs?: number;
}

export interface Parsers {
  versions: Record<string, string>;
  mode: 'tree-sitter' | 'legacy' | 'mixed';
}

export interface Security {
  limits: {
    maxArchiveEntries?: number;
    maxFiles?: number;
    maxFileBytes?: number;
    maxArchiveBytes?: number;
    maxTotalExtractedBytes?: number;
    maxAstNodes?: number;
    maxAstDepth?: number;
  };
  truncated: string[];
  executedRepositoryCode: false;
}

export type CompletenessStatus = 'FULLY_MAPPED' | 'MOSTLY_MAPPED' | 'PARTIAL' | 'COVERAGE_LIMITED';

export interface Completeness {
  status: CompletenessStatus;
  reasons: string[];
}

export interface RepoDNAProjectV2 {
  schemaVersion: '2.0.0';
  generatedAt: string;
  repository: {
    name: string;
    source: string;
    commitSha: string | null;
    analyzedRef: string | null;
    languages: Record<string, number>;
    fingerprint: {
      languages: string[];
      frameworks: string[];
      infrastructure: string[];
      databases: string[];
      externalSystems: string[];
      testing: string[];
      buildTools: string[];
      tooling?: string[];
      languageFileCounts: Record<string, number>;
    };
  };
  inventory: Inventory;
  coverage: Coverage;
  nodes: GraphNode[];
  edges: GraphEdge[];
  architecture: {
    components: ArchitectureComponent[];
    connections: ArchitectureConnection[];
  };
  flows: FlowRecord[];
  communities: Community[];
  dependencyCycles: string[][];
  centrality: Centrality;
  unresolved: Unresolved[];
  diagnostics: Diagnostic[];
  timings: Timings;
  parsers: Parsers;
  security: Security;
  completeness: Completeness;
  entrypoints?: EntrypointRecord[];
  databases?: TechnologyBoundary[];
  externalSystems?: TechnologyBoundary[];
  external_systems?: TechnologyBoundary[];
  metadata?: {
    analyzerVersion?: string;
    analysisMode?: string;
    cache?: { hits: number; misses: number };
  };
}

export const V2_SCHEMA_VERSION = '2.0.0' as const;
export const V1_SCHEMA_VERSION = '1.1.0' as const;

/**
 * GraphStore adapter boundary — JSON remains authoritative.
 * Future Neo4j/Cypher adapter implements this without coupling the web app to Neo4j.
 */
export interface GraphStore {
  load(project: RepoDNAProjectV2): Promise<void>;
  query(query: string, params?: Record<string, unknown>): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
  getNode(id: string): Promise<GraphNode | null>;
  getNeighborhood(nodeId: string, depth?: number, limit?: number): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
  explainEdge(edgeId: string): Promise<{ edge: GraphEdge; evidence: string; alternatives: string[] }>;
  close(): Promise<void>;
}

/**
 * Deterministic stable ID from repo, commit, path, kind, qname, range.
 * Must be stable across runs for same content.
 */
export function stableNodeId(opts: {
  repository: string;
  commitSha: string | null;
  path: string;
  kind: GraphNodeKind;
  qualifiedName: string;
  range: SourceRange;
}): string {
  const { repository, commitSha, path, kind, qualifiedName, range } = opts;
  const seed = `${repository}::${commitSha ?? 'local'}::${path}::${kind}::${qualifiedName}::${range.startLine}:${range.startCol}-${range.endLine}:${range.endCol}`;
  // Simple deterministic hash — FNV-like, not crypto, but stable and fast for IDs
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Also include length for collision reduction
  return `node_${(hash >>> 0).toString(16).padStart(8, '0')}_${qualifiedName.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 48)}`;
}

export function stableEdgeId(opts: {
  source: string;
  target: string | null;
  type: GraphEdgeType;
  file: string;
  range: SourceRange;
}): string {
  const { source, target, type, file, range } = opts;
  const seed = `${source}::${target ?? 'null'}::${type}::${file}::${range.startLine}:${range.startCol}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `edge_${(hash >>> 0).toString(16).padStart(8, '0')}_${type.toLowerCase()}`;
}
