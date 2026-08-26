import { GraphExportError, type GraphExportDocumentV1 } from './types';

const MAX_REPORTED_VIOLATIONS = 25;

function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

function isSorted(ids: string[]): boolean {
  for (let i = 1; i < ids.length; i++) {
    if (ids[i - 1] > ids[i]) return false;
  }
  return true;
}

export function collectExportViolations(document: GraphExportDocumentV1): string[] {
  const violations: string[] = [];
  const { manifest, nodes, relationships, groups, groupMemberships, unresolved } = document;

  const nodeIds = new Set(nodes.map((node) => node.id));
  const groupIds = new Set(groups.map((group) => group.id));
  const relationshipIds = new Set(relationships.map((relationship) => relationship.id));

  for (const id of findDuplicates(nodes.map((node) => node.id))) {
    violations.push(`duplicate node id: ${id}`);
  }
  for (const id of findDuplicates(relationships.map((relationship) => relationship.id))) {
    violations.push(`duplicate relationship id: ${id}`);
  }
  for (const id of findDuplicates(groups.map((group) => group.id))) {
    violations.push(`duplicate group id: ${id}`);
  }

  for (const relationship of relationships) {
    if (!nodeIds.has(relationship.sourceId)) {
      violations.push(`relationship ${relationship.id} has dangling source ${relationship.sourceId}`);
    }
    if (relationship.targetId !== null && !nodeIds.has(relationship.targetId)) {
      violations.push(`relationship ${relationship.id} has dangling target ${relationship.targetId}`);
    }
    if (relationship.targetId === null && relationship.status !== 'unresolved' && relationship.status !== 'ambiguous') {
      violations.push(`relationship ${relationship.id} has null target but status ${relationship.status}`);
    }
    if (!relationship.why) {
      violations.push(`relationship ${relationship.id} is missing its why explanation`);
    }
  }

  for (const membership of groupMemberships) {
    if (!groupIds.has(membership.groupId)) {
      violations.push(`membership references unknown group ${membership.groupId}`);
    }
    if (!nodeIds.has(membership.nodeId)) {
      violations.push(`membership references unknown node ${membership.nodeId}`);
    }
  }

  for (const entry of unresolved) {
    if (!relationshipIds.has(entry.edgeId)) {
      violations.push(`unresolved entry references unknown relationship ${entry.edgeId}`);
    }
  }

  if (!isSorted(nodes.map((node) => node.id))) violations.push('nodes are not sorted by id');
  if (!isSorted(relationships.map((relationship) => relationship.id))) violations.push('relationships are not sorted by id');
  if (!isSorted(groups.map((group) => group.id))) violations.push('groups are not sorted by id');
  if (!isSorted(unresolved.map((entry) => entry.edgeId))) violations.push('unresolved entries are not sorted by edgeId');

  const counts = manifest.counts;
  if (counts.nodes !== nodes.length) violations.push(`manifest node count ${counts.nodes} != ${nodes.length}`);
  if (counts.relationships !== relationships.length) {
    violations.push(`manifest relationship count ${counts.relationships} != ${relationships.length}`);
  }
  if (counts.groups !== groups.length) violations.push(`manifest group count ${counts.groups} != ${groups.length}`);
  if (counts.groupMemberships !== groupMemberships.length) {
    violations.push(`manifest membership count ${counts.groupMemberships} != ${groupMemberships.length}`);
  }
  if (counts.unresolved !== unresolved.length) {
    violations.push(`manifest unresolved count ${counts.unresolved} != ${unresolved.length}`);
  }
  if (!/^[0-9a-f]{64}$/.test(manifest.sourceArtifactSha256)) {
    violations.push('manifest sourceArtifactSha256 is not a sha-256 hex digest');
  }

  return violations;
}

export function assertExportableDocument(document: GraphExportDocumentV1): void {
  const violations = collectExportViolations(document);
  if (violations.length === 0) return;
  throw new GraphExportError(
    'EXPORT_GRAPH_INVALID',
    `Graph export failed validation with ${violations.length} violation(s).`,
    violations.slice(0, MAX_REPORTED_VIOLATIONS)
  );
}
