import type { GraphEdge, RepoDNAProjectV2 } from './analyzer/v2/types';

export interface ResolutionGap {
  id: string;
  edge: GraphEdge | null;
  reason: string;
  candidates: string[];
}

/** Preserve orphan records too: absence of an edge is not proof of resolution. */
export function resolutionGaps(project: RepoDNAProjectV2): ResolutionGap[] {
  const gaps = new Map<string, ResolutionGap>();
  const edgeById = new Map(project.edges.map((edge) => [edge.id, edge]));
  const nodeIds = new Set(project.nodes.map((node) => node.id));
  for (const record of project.unresolved) {
    const edge = edgeById.get(record.edgeId) ?? null;
    const existing = gaps.get(record.edgeId);
    gaps.set(record.edgeId, {
      id: record.edgeId, edge,
      reason: [...new Set([...(existing ? [existing.reason] : []), record.reason])].join('; '),
      candidates: [...new Set([...(existing?.candidates ?? []), ...record.candidates, ...(edge?.alternativeCandidates ?? [])])].sort(),
    });
  }
  for (const edge of project.edges) {
    const missingSource = !nodeIds.has(edge.source);
    const missingTarget = edge.target !== null && !nodeIds.has(edge.target);
    if (gaps.has(edge.id) || (!missingSource && !missingTarget && edge.target !== null && edge.status !== 'unresolved' && edge.status !== 'ambiguous')) continue;
    const reason = missingSource ? 'source-node-not-found' : missingTarget ? 'target-node-not-found' : edge.explanation || `status:${edge.status}`;
    gaps.set(edge.id, { id: edge.id, edge, reason, candidates: [...new Set(edge.alternativeCandidates ?? [])].sort() });
  }
  return [...gaps.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function resolutionGapNodeIds(gaps: ResolutionGap[]): Set<string> {
  return new Set(gaps.flatMap((gap) => [
    ...(gap.edge ? [gap.edge.source, ...(gap.edge.target ? [gap.edge.target] : [])] : []),
    ...gap.candidates,
  ]));
}

export function isDrawableGraphEdge(edge: GraphEdge): boolean {
  return edge.target !== null && edge.target !== edge.source;
}
