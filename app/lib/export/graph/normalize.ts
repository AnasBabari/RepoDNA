import { adaptV1ToV2Viewer } from '../../schema/artifact-loader';
import type { RepoDNAProject } from '../../types';
import type { GraphEdge, GraphNode, RepoDNAProjectV2 } from '../../analyzer/v2/types';
import { compactStableStringify, sha256Hex } from './stable-json';
import {
  GRAPH_EXPORT_SCHEMA_VERSION,
  GRAPH_EXPORTER_VERSION,
  type GraphExportDocumentV1,
  type GraphExportGroup,
  type GraphExportManifest,
  type GraphExportNode,
  type GraphExportRelationship,
  type GraphExportUnresolved,
  type GraphGroupMembership,
} from './types';
import { assertExportableDocument } from './validate';

export type AnyExportableArtifact = RepoDNAProject | RepoDNAProjectV2;

export interface NormalizedGraphExport {
  document: GraphExportDocumentV1;
  sourceDigest: string;
  adaptedFromLegacy: boolean;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareIds);
}

function isV2Artifact(artifact: AnyExportableArtifact): artifact is RepoDNAProjectV2 {
  return (artifact as RepoDNAProjectV2).schemaVersion === '2.0.0';
}

interface NodeProjection {
  source: GraphNode;
  exportId: string;
  duplicateIndex: number;
  synthetic: boolean;
}

interface NodeIndex {
  projections: NodeProjection[];
  firstBySourceId: Map<string, NodeProjection>;
  allBySourceId: Map<string, NodeProjection[]>;
  duplicateCount: number;
  syntheticCount: number;
}

interface RelationshipProjection {
  edge: GraphEdge;
  exportId: string;
  source: NodeProjection;
  target: NodeProjection | null;
  sourceMissing: boolean;
  targetMissing: boolean;
  status: GraphEdge['status'];
}

function allocateUniqueId(base: string, occurrenceByBase: Map<string, number>, usedIds: Set<string>): string {
  let occurrence = occurrenceByBase.get(base) ?? 0;
  let candidate = occurrence === 0 ? base : `${base}#duplicate-${occurrence + 1}`;
  while (usedIds.has(candidate)) {
    occurrence += 1;
    candidate = `${base}#duplicate-${occurrence + 1}`;
  }
  occurrenceByBase.set(base, occurrence + 1);
  usedIds.add(candidate);
  return candidate;
}

function buildNodeIndex(project: RepoDNAProjectV2): NodeIndex {
  const projections: NodeProjection[] = [];
  const firstBySourceId = new Map<string, NodeProjection>();
  const allBySourceId = new Map<string, NodeProjection[]>();
  const occurrenceByBase = new Map<string, number>();
  const usedIds = new Set<string>();

  for (const source of project.nodes) {
    const existing = allBySourceId.get(source.id) ?? [];
    const projection: NodeProjection = {
      source,
      exportId: allocateUniqueId(source.id, occurrenceByBase, usedIds),
      duplicateIndex: existing.length,
      synthetic: false,
    };
    existing.push(projection);
    allBySourceId.set(source.id, existing);
    firstBySourceId.set(source.id, firstBySourceId.get(source.id) ?? projection);
    projections.push(projection);
  }

  return {
    projections,
    firstBySourceId,
    allBySourceId,
    duplicateCount: projections.filter((projection) => projection.duplicateIndex > 0).length,
    syntheticCount: 0,
  };
}

function addSyntheticSourceNodes(project: RepoDNAProjectV2, index: NodeIndex): void {
  const missingSourceIds = new Set(
    project.edges
      .map((edge) => edge.source)
      .filter((sourceId) => !index.firstBySourceId.has(sourceId))
  );
  if (missingSourceIds.size === 0) return;

  const occurrenceByBase = new Map<string, number>();
  const usedIds = new Set(index.projections.map((projection) => projection.exportId));
  for (const sourceId of [...missingSourceIds].sort(compareIds)) {
    const edge = project.edges.find((candidate) => candidate.source === sourceId);
    const syntheticNode: GraphNode = {
      id: sourceId,
      kind: 'external_system',
      name: sourceId || 'Unresolved source',
      qualifiedName: sourceId,
      path: edge?.evidence.file ?? '',
      language: 'unknown',
      range: edge?.evidence.range ?? { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
      evidence: edge ? [`source-node-not-found:${edge.evidence.file}`] : ['source-node-not-found'],
      metadata: { synthetic: true, unresolvedSourceId: sourceId },
    };
    const projection: NodeProjection = {
      source: syntheticNode,
      exportId: allocateUniqueId(`unresolved-source:${sourceId}`, occurrenceByBase, usedIds),
      duplicateIndex: 0,
      synthetic: true,
    };
    index.projections.push(projection);
    index.firstBySourceId.set(sourceId, projection);
    index.allBySourceId.set(sourceId, [projection]);
    index.syntheticCount += 1;
  }
}

function nodeProperties(projection: NodeProjection): Record<string, unknown> {
  const properties = { ...(projection.source.metadata ?? {}) };
  if (projection.duplicateIndex > 0) {
    const existing = properties.__repodna;
    properties.__repodna = {
      ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}),
      originalId: projection.source.id,
      duplicateIndex: projection.duplicateIndex + 1,
    };
  }
  return properties;
}

function buildNodes(
  index: NodeIndex,
  communityIdsByNode: Map<string, string[]>,
  architectureIdsByPath: Map<string, string[]>
): GraphExportNode[] {
  return index.projections
    .map((projection): GraphExportNode => ({
      id: projection.exportId,
      kind: projection.source.kind,
      name: projection.source.name,
      qualifiedName: projection.source.qualifiedName,
      path: projection.source.path,
      language: projection.source.language,
      range: { ...projection.source.range },
      confidence: typeof projection.source.confidence === 'number' ? projection.source.confidence : null,
      evidence: [...(projection.source.evidence ?? [])],
      properties: nodeProperties(projection),
      communityIds: sortedUnique(communityIdsByNode.get(projection.source.id) ?? []),
      architectureGroupIds: sortedUnique(architectureIdsByPath.get(normalizePath(projection.source.path)) ?? []),
    }))
    .sort((a, b) => compareIds(a.id, b.id));
}

function buildRelationshipProjections(project: RepoDNAProjectV2, index: NodeIndex): RelationshipProjection[] {
  const occurrenceByBase = new Map<string, number>();
  const usedIds = new Set<string>();
  return project.edges.map((edge) => {
    const source = index.firstBySourceId.get(edge.source);
    const target = edge.target === null ? null : index.firstBySourceId.get(edge.target) ?? null;
    const sourceMissing = source === undefined;
    const targetMissing = edge.target !== null && target === null;
    const status = sourceMissing || targetMissing || edge.target === null
      ? edge.status === 'ambiguous' || edge.status === 'unresolved' ? edge.status : 'unresolved'
      : edge.status;
    return {
      edge,
      exportId: allocateUniqueId(edge.id, occurrenceByBase, usedIds),
      source: source ?? {
        source: {
          id: edge.source,
          kind: 'external_system',
          name: edge.source || 'Unresolved source',
          qualifiedName: edge.source,
          path: edge.evidence.file,
          language: 'unknown',
          range: { ...edge.evidence.range },
          evidence: ['source-node-not-found'],
          metadata: { synthetic: true },
        },
        exportId: `unresolved-source:${edge.source}`,
        duplicateIndex: 0,
        synthetic: true,
      },
      target,
      sourceMissing,
      targetMissing,
      status,
    };
  });
}

function edgeWhy(projection: RelationshipProjection): string {
  if (typeof projection.edge.explanation === 'string' && projection.edge.explanation.trim()) {
    return projection.edge.explanation;
  }
  if (projection.sourceMissing) return 'Source node was not present in the analyzed graph.';
  if (projection.targetMissing) return 'Target node was not present in the analyzed graph.';
  return `Relationship status: ${projection.status}`;
}

function buildRelationships(projections: RelationshipProjection[]): GraphExportRelationship[] {
  return projections
    .map((projection): GraphExportRelationship => {
      const { edge, source, target } = projection;
      const properties = { ...(edge.metadata ?? {}) };
      if (projection.sourceMissing || projection.targetMissing) {
        const existing = properties.__repodna;
        properties.__repodna = {
          ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}),
          ...(projection.sourceMissing ? { sourceNodeMissing: true } : {}),
          ...(projection.targetMissing ? { targetNodeMissing: true, originalTargetId: edge.target } : {}),
        };
      }
      return {
        id: projection.exportId,
        sourceId: source.exportId,
        targetId: target?.exportId ?? null,
        sourceName: source.source.name,
        sourceKind: source.source.kind,
        sourcePath: source.source.path,
        targetName: target?.source.name ?? null,
        targetKind: target?.source.kind ?? null,
        targetPath: target?.source.path ?? null,
        type: edge.type,
        status: projection.status,
        confidence: edge.confidence,
        why: edgeWhy(projection),
        evidenceFile: edge.evidence.file,
        evidenceRange: { ...edge.evidence.range },
        resolverName: edge.resolver.name,
        resolverVersion: edge.resolver.version,
        alternativeCandidateIds: sortedUnique(edge.alternativeCandidates ?? []),
        unresolvedExpression: edge.unresolvedExpression ?? (projection.targetMissing ? edge.target : null),
        properties,
      };
    })
    .sort((a, b) => compareIds(a.id, b.id));
}

function buildGroups(project: RepoDNAProjectV2): GraphExportGroup[] {
  const communityGroups: GraphExportGroup[] = project.communities.map((community) => ({
    id: `community:${community.id}`,
    groupType: 'community',
    label: community.label,
    cohesion: community.cohesion,
    architectureType: null,
    confidence: null,
    evidence: [],
    properties: {},
  }));
  const architectureGroups: GraphExportGroup[] = project.architecture.components.map((component) => ({
    id: `architecture:${component.id}`,
    groupType: 'architecture',
    label: component.name,
    cohesion: null,
    architectureType: component.type,
    confidence: component.confidence,
    evidence: [...component.evidence],
    properties: {},
  }));
  return [...communityGroups, ...architectureGroups].sort((a, b) => compareIds(a.id, b.id));
}

function buildMemberships(
  project: RepoDNAProjectV2,
  index: NodeIndex,
  nodeIdsByPath: Map<string, string[]>
): GraphGroupMembership[] {
  const memberships: GraphGroupMembership[] = [];
  for (const community of project.communities) {
    for (const member of community.members) {
      for (const projection of index.allBySourceId.get(member) ?? []) {
        memberships.push({
          groupId: `community:${community.id}`,
          nodeId: projection.exportId,
          membershipReason: 'community-detection',
        });
      }
    }
  }
  for (const component of project.architecture.components) {
    for (const file of component.files) {
      for (const nodeId of nodeIdsByPath.get(normalizePath(file)) ?? []) {
        memberships.push({
          groupId: `architecture:${component.id}`,
          nodeId,
          membershipReason: 'architecture-file-membership',
        });
      }
    }
  }
  const deduped = new Map<string, GraphGroupMembership>();
  for (const membership of memberships) {
    deduped.set(`${membership.groupId}\u0000${membership.nodeId}`, membership);
  }
  return [...deduped.values()].sort(
    (a, b) => compareIds(a.groupId, b.groupId) || compareIds(a.nodeId, b.nodeId)
  );
}

function buildUnresolved(
  project: RepoDNAProjectV2,
  projections: RelationshipProjection[]
): GraphExportUnresolved[] {
  const recordedByEdgeId = new Map<string, RepoDNAProjectV2['unresolved']>();
  for (const entry of project.unresolved) {
    const bucket = recordedByEdgeId.get(entry.edgeId);
    if (bucket) bucket.push(entry);
    else recordedByEdgeId.set(entry.edgeId, [entry]);
  }
  const occurrenceByEdgeId = new Map<string, number>();
  return projections
    .filter((projection) => projection.status === 'unresolved' || projection.status === 'ambiguous')
    .map((projection): GraphExportUnresolved => {
      const occurrence = occurrenceByEdgeId.get(projection.edge.id) ?? 0;
      occurrenceByEdgeId.set(projection.edge.id, occurrence + 1);
      const recorded = recordedByEdgeId.get(projection.edge.id)?.[occurrence];
      const missingTargetReason = projection.targetMissing ? 'target-node-not-found' : null;
      const missingSourceReason = projection.sourceMissing ? 'source-node-not-found' : null;
      return {
        edgeId: projection.exportId,
        sourceId: projection.source.exportId,
        relationshipType: projection.edge.type,
        reason: recorded?.reason ?? missingSourceReason ?? missingTargetReason ?? `status:${projection.status}`,
        unresolvedExpression:
          projection.edge.unresolvedExpression ?? (projection.targetMissing ? projection.edge.target : null),
        candidateIds: sortedUnique([
          ...(projection.edge.alternativeCandidates ?? []),
          ...(projection.targetMissing && projection.edge.target ? [projection.edge.target] : []),
          ...(recorded?.candidates ?? []),
        ]),
        evidenceFile: projection.edge.evidence.file,
        evidenceRange: { ...projection.edge.evidence.range },
      };
    })
    .sort((a, b) => compareIds(a.edgeId, b.edgeId));
}

export function buildGraphExportDocument(
  project: RepoDNAProjectV2,
  options: {
    sourceDigest: string;
    sourceSchemaVersion: '2.0.0' | '1.1.0';
    adaptedFromLegacy: boolean;
  }
): GraphExportDocumentV1 {
  const nodeIndex = buildNodeIndex(project);
  addSyntheticSourceNodes(project, nodeIndex);

  const nodeIdsByPath = new Map<string, string[]>();
  for (const projection of nodeIndex.projections) {
    const key = normalizePath(projection.source.path);
    if (!key) continue;
    const bucket = nodeIdsByPath.get(key);
    if (bucket) bucket.push(projection.exportId);
    else nodeIdsByPath.set(key, [projection.exportId]);
  }

  const communityIdsByNode = new Map<string, string[]>();
  for (const community of project.communities) {
    for (const member of community.members) {
      const bucket = communityIdsByNode.get(member);
      const id = `community:${community.id}`;
      if (bucket) bucket.push(id);
      else communityIdsByNode.set(member, [id]);
    }
  }

  const architectureIdsByPath = new Map<string, string[]>();
  for (const component of project.architecture.components) {
    for (const file of component.files) {
      const key = normalizePath(file);
      const bucket = architectureIdsByPath.get(key);
      const id = `architecture:${component.id}`;
      if (bucket) bucket.push(id);
      else architectureIdsByPath.set(key, [id]);
    }
  }

  const nodes = buildNodes(nodeIndex, communityIdsByNode, architectureIdsByPath);
  const relationshipProjections = buildRelationshipProjections(project, nodeIndex);
  const relationships = buildRelationships(relationshipProjections);
  const groups = buildGroups(project);
  const groupMemberships = buildMemberships(project, nodeIndex, nodeIdsByPath);
  const unresolved = buildUnresolved(project, relationshipProjections);

  const normalizationReasons: string[] = [];
  if (nodeIndex.duplicateCount > 0) {
    normalizationReasons.push(`export-disambiguated-${nodeIndex.duplicateCount}-duplicate-node-ids`);
  }
  const duplicateRelationshipCount = relationshipProjections.length - new Set(relationshipProjections.map((entry) => entry.edge.id)).size;
  if (duplicateRelationshipCount > 0) {
    normalizationReasons.push(`export-disambiguated-${duplicateRelationshipCount}-duplicate-relationship-ids`);
  }
  if (nodeIndex.syntheticCount > 0) {
    normalizationReasons.push(`export-added-${nodeIndex.syntheticCount}-unresolved-source-nodes`);
  }
  const missingTargetCount = relationshipProjections.filter((projection) => projection.targetMissing).length;
  if (missingTargetCount > 0) {
    normalizationReasons.push(`export-marked-${missingTargetCount}-missing-targets-unresolved`);
  }

  const manifest: GraphExportManifest = {
    exportSchemaVersion: GRAPH_EXPORT_SCHEMA_VERSION,
    exporterVersion: GRAPH_EXPORTER_VERSION,
    sourceSchemaVersion: options.sourceSchemaVersion,
    analyzerVersion: project.metadata?.analyzerVersion ?? 'unknown',
    sourceArtifactSha256: options.sourceDigest,
    repository: {
      name: project.repository.name,
      source: project.repository.source,
      commitSha: project.repository.commitSha,
      analyzedRef: project.repository.analyzedRef,
    },
    analyzedAt: project.generatedAt,
    coverage: {
      percentage: project.coverage.percentage,
      truncationReasons: [...project.coverage.truncationReasons],
    },
    completeness: {
      status: project.completeness.status,
      reasons: [...project.completeness.reasons, ...normalizationReasons],
    },
    executedRepositoryCode: false,
    adaptedFromLegacy: options.adaptedFromLegacy,
    ordering: 'stable-id-ascending',
    csvFormulaEscaping: 'apostrophe-prefix-on-formula-leading-characters',
    counts: {
      nodes: nodes.length,
      relationships: relationships.length,
      groups: groups.length,
      groupMemberships: groupMemberships.length,
      unresolved: unresolved.length,
    },
  };

  return { manifest, nodes, relationships, groups, groupMemberships, unresolved };
}

export async function computeSourceArtifactDigest(artifact: AnyExportableArtifact): Promise<string> {
  return sha256Hex(compactStableStringify(artifact));
}

export async function normalizeArtifactForExport(artifact: AnyExportableArtifact): Promise<NormalizedGraphExport> {
  const isV2 = isV2Artifact(artifact);
  const project = isV2 ? artifact : adaptV1ToV2Viewer(artifact);
  const sourceDigest = await computeSourceArtifactDigest(artifact);
  const document = buildGraphExportDocument(project, {
    sourceDigest,
    sourceSchemaVersion: isV2 ? '2.0.0' : '1.1.0',
    adaptedFromLegacy: !isV2,
  });
  assertExportableDocument(document);
  return { document, sourceDigest, adaptedFromLegacy: !isV2 };
}
