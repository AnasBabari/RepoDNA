import type { GraphScope, GraphScopeCounts, RepoDNAProjectV2 } from './analyzer/v2/types';

export const GRAPH_COUNT_KEYS = ['nodes', 'relationships', 'unresolvedRelationships', 'ambiguousRelationships'] as const;

export function graphCounts(project: RepoDNAProjectV2): GraphScopeCounts {
  return {
    nodes: project.nodes.length,
    relationships: project.edges.length,
    unresolvedRelationships: new Set([
      ...project.unresolved.map((record) => record.edgeId),
      ...project.edges.filter((edge) => edge.target === null || edge.status === 'unresolved' || edge.status === 'ambiguous').map((edge) => edge.id),
    ]).size,
    ambiguousRelationships: project.edges.filter((edge) => edge.status === 'ambiguous').length,
  };
}

export function recordedGraphScope(original: GraphScopeCounts, retained: GraphScopeCounts): GraphScope {
  const compacted = GRAPH_COUNT_KEYS.some((key) => original[key] === null || original[key] !== retained[key]);
  const omitted = Object.fromEntries(GRAPH_COUNT_KEYS.map((key) => [key,
    original[key] === null || retained[key] === null ? null : Math.max(0, original[key]! - retained[key]!),
  ])) as unknown as GraphScopeCounts;
  return { kind: compacted ? 'compacted' : 'uncompacted', original, retained, omitted, analyticsScope: compacted ? 'retained-subgraph' : 'uncompacted-extracted-graph' };
}

/** Older compacted artifacts did not save original totals. Unknown is not zero. */
export function resolveGraphScope(project: RepoDNAProjectV2): GraphScope {
  const retained = graphCounts(project);
  const codes = [...project.coverage.truncationReasons, ...project.security.truncated, ...(project.inventory.truncation?.hitLimits ?? []), ...project.diagnostics.map((item) => item.code)];
  const compacted = project.graphScope?.kind === 'compacted' || codes.some((code) => /^GRAPH_(NODES|EDGES)_COMPACTED$/.test(code));
  if (!compacted) return recordedGraphScope(retained, retained);
  const original = Object.fromEntries(GRAPH_COUNT_KEYS.map((key) => {
    const value = project.graphScope?.original[key];
    return [key, typeof value === 'number' && Number.isSafeInteger(value) && value >= retained[key]! ? value : null];
  })) as unknown as GraphScopeCounts;
  return { ...recordedGraphScope(original, retained), kind: 'compacted', analyticsScope: 'retained-subgraph' };
}

export function formatGraphCount(value: number | null): string {
  return value === null ? 'unknown' : value.toLocaleString('en-US');
}
