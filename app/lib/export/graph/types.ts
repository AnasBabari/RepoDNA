import type { GraphEdgeStatus, GraphEdgeType, GraphNodeKind, SourceRange } from '../../analyzer/v2/types';

export const GRAPH_EXPORT_SCHEMA_VERSION = '1.0.0' as const;
export const GRAPH_EXPORTER_VERSION = '1.0.0' as const;

export type GraphExportFormat = 'graph-json' | 'csv' | 'cypher' | 'parquet';

export type GraphExportErrorCode =
  | 'INVALID_EXPORT_REQUEST'
  | 'UNSUPPORTED_EXPORT_FORMAT'
  | 'PARQUET_EXPORT_DISABLED'
  | 'ANALYSIS_ARTIFACT_NOT_FOUND'
  | 'ANALYSIS_ARTIFACT_EXPIRED'
  | 'EXPORT_GRAPH_INVALID'
  | 'EXPORT_TOO_LARGE'
  | 'EXPORT_GENERATION_FAILED'
  | 'EXPORT_CACHE_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'RATE_LIMIT_UNAVAILABLE';

export class GraphExportError extends Error {
  readonly code: GraphExportErrorCode;
  readonly details: string[];

  constructor(code: GraphExportErrorCode, message: string, details: string[] = []) {
    super(message);
    this.name = 'GraphExportError';
    this.code = code;
    this.details = details;
  }
}

export interface GraphExportManifest {
  exportSchemaVersion: typeof GRAPH_EXPORT_SCHEMA_VERSION;
  exporterVersion: string;
  sourceSchemaVersion: '2.0.0' | '1.1.0';
  analyzerVersion: string;
  sourceArtifactSha256: string;
  repository: {
    name: string;
    source: string;
    commitSha: string | null;
    analyzedRef: string | null;
  };
  analyzedAt: string;
  coverage: {
    percentage: number;
    truncationReasons: string[];
  };
  completeness: {
    status: string;
    reasons: string[];
  };
  executedRepositoryCode: false;
  adaptedFromLegacy: boolean;
  ordering: 'stable-id-ascending';
  csvFormulaEscaping: 'apostrophe-prefix-on-formula-leading-characters';
  counts: {
    nodes: number;
    relationships: number;
    groups: number;
    groupMemberships: number;
    unresolved: number;
  };
}

export interface GraphExportNode {
  id: string;
  kind: GraphNodeKind;
  name: string;
  qualifiedName: string;
  path: string;
  language: string;
  range: SourceRange;
  confidence: number | null;
  evidence: string[];
  properties: Record<string, unknown>;
  communityIds: string[];
  architectureGroupIds: string[];
}

export interface GraphExportRelationship {
  id: string;
  sourceId: string;
  targetId: string | null;
  sourceName: string;
  sourceKind: GraphNodeKind | null;
  sourcePath: string;
  targetName: string | null;
  targetKind: GraphNodeKind | null;
  targetPath: string | null;
  type: GraphEdgeType;
  status: GraphEdgeStatus;
  confidence: number;
  why: string;
  evidenceFile: string;
  evidenceRange: SourceRange;
  resolverName: string;
  resolverVersion: string;
  alternativeCandidateIds: string[];
  unresolvedExpression: string | null;
  properties: Record<string, unknown>;
}

export type GraphExportGroupType = 'community' | 'architecture';

export interface GraphExportGroup {
  id: string;
  groupType: GraphExportGroupType;
  label: string;
  cohesion: number | null;
  architectureType: string | null;
  confidence: number | null;
  evidence: string[];
  properties: Record<string, unknown>;
}

export type GraphGroupMembershipReason = 'community-detection' | 'architecture-file-membership';

export interface GraphGroupMembership {
  groupId: string;
  nodeId: string;
  membershipReason: GraphGroupMembershipReason;
}

export interface GraphExportUnresolved {
  edgeId: string;
  sourceId: string;
  relationshipType: GraphEdgeType;
  reason: string;
  unresolvedExpression: string | null;
  candidateIds: string[];
  evidenceFile: string;
  evidenceRange: SourceRange;
}

export interface GraphExportDocumentV1 {
  manifest: GraphExportManifest;
  nodes: GraphExportNode[];
  relationships: GraphExportRelationship[];
  groups: GraphExportGroup[];
  groupMemberships: GraphGroupMembership[];
  unresolved: GraphExportUnresolved[];
}

export interface GraphExportFile {
  format: GraphExportFormat;
  filename: string;
  mediaType: string;
  bytes: Uint8Array;
  byteSize: number;
  sha256: string;
}

export const GRAPH_EXPORT_MEDIA_TYPES: Record<GraphExportFormat, string> = {
  'graph-json': 'application/vnd.repodna.graph+json; charset=utf-8',
  csv: 'application/zip',
  cypher: 'text/plain; charset=utf-8',
  parquet: 'application/zip',
};

export const GRAPH_EXPORT_EXTENSIONS: Record<GraphExportFormat, string> = {
  'graph-json': 'json',
  csv: 'zip',
  cypher: 'txt',
  parquet: 'zip',
};

export const GRAPH_EXPORT_FORMATS: readonly GraphExportFormat[] = ['graph-json', 'csv', 'cypher', 'parquet'];

export function isGraphExportFormat(value: unknown): value is GraphExportFormat {
  return typeof value === 'string' && (GRAPH_EXPORT_FORMATS as readonly string[]).includes(value);
}
