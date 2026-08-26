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

function buildNodes(
  project: RepoDNAProjectV2,
  communityIdsByNode: Map<string, string[]>,
  architectureIdsByPath: Map<string, string[]>
): GraphExportNode[] {
  return project.nodes
    .map((node: GraphNode): GraphExportNode => ({
      id: node.id,
      kind: node.kind,
      name: node.name,
      qualifiedName: node.qualifiedName,
      path: node.path,
      language: node.language,
      range: { ...node.range },
      confidence: typeof node.confidence === 'number' ? node.confidence : null,
      evidence: [...(node.evidence ?? [])],
      properties: { ...(node.metadata ?? {}) },
      communityIds: sortedUnique(communityIdsByNode.get(node.id) ?? []),
      architectureGroupIds: sortedUnique(architectureIdsByPath.get(normalizePath(node.path)) ?? []),
    }))
    .sort((a, b) => compareIds(a.id, b.id));
}

function buildRelationships(project: RepoDNAProjectV2, nodesById: Map<string, GraphNode>): GraphExportRelationship[] {
  return project.edges
    .map((edge: GraphEdge): GraphExportRelationship => {
      const source = nodesById.get(edge.source) ?? null;
      const target = edge.target === null ? null : nodesById.get(edge.target) ?? null;
      return {
        id: edge.id,
        sourceId: edge.source,
        targetId: edge.target,
        sourceName: source?.name ?? '',
        sourceKind: source?.kind ?? null,
        sourcePath: source?.path ?? '',
        targetName: target?.name ?? null,
        targetKind: target?.kind ?? null,
        targetPath: target?.path ?? null,
        type: edge.type,
        status: edge.status,
        confidence: edge.confidence,
        why: edge.explanation,
        evidenceFile: edge.evidence.file,
        evidenceRange: { ...edge.evidence.range },
        resolverName: edge.resolver.name,
        resolverVersion: edge.resolver.version,
        alternativeCandidateIds: sortedUnique(edge.alternativeCandidates ?? []),
        unresolvedExpression: edge.unresolvedExpression ?? null,
        properties: { ...(edge.metadata ?? {}) },
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
  nodeIds: Set<string>,
  nodeIdsByPath: Map<string, string[]>
): GraphGroupMembership[] {
  const memberships: GraphGroupMembership[] = [];
  for (const community of project.communities) {
    for (const member of community.members) {
      if (!nodeIds.has(member)) continue;
      memberships.push({
        groupId: `community:${community.id}`,
        nodeId: member,
        membershipReason: 'community-detection',
      });
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

function buildUnresolved(project: RepoDNAProjectV2): GraphExportUnresolved[] {
  const reasonByEdgeId = new Map(project.unresolved.map((entry) => [entry.edgeId, entry]));
  return project.edges
    .filter((edge) => edge.status === 'unresolved' || edge.status === 'ambiguous')
    .map((edge): GraphExportUnresolved => {
      const recorded = reasonByEdgeId.get(edge.id);
      return {
        edgeId: edge.id,
        sourceId: edge.source,
        relationshipType: edge.type,
        reason: recorded?.reason ?? `status:${edge.status}`,
        unresolvedExpression: edge.unresolvedExpression ?? null,
        candidateIds: sortedUnique([...(edge.alternativeCandidates ?? []), ...(recorded?.candidates ?? [])]),
        evidenceFile: edge.evidence.file,
        evidenceRange: { ...edge.evidence.range },
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
  const nodesById = new Map(project.nodes.map((node) => [node.id, node]));
  const nodeIds = new Set(nodesById.keys());

  const nodeIdsByPath = new Map<string, string[]>();
  for (const node of project.nodes) {
    const key = normalizePath(node.path);
    if (!key) continue;
    const bucket = nodeIdsByPath.get(key);
    if (bucket) bucket.push(node.id);
    else nodeIdsByPath.set(key, [node.id]);
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

  const nodes = buildNodes(project, communityIdsByNode, architectureIdsByPath);
  const relationships = buildRelationships(project, nodesById);
  const groups = buildGroups(project);
  const groupMemberships = buildMemberships(project, nodeIds, nodeIdsByPath);
  const unresolved = buildUnresolved(project);

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
      reasons: [...project.completeness.reasons],
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
