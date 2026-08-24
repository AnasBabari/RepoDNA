import type { GraphEdge, GraphNode } from './types';

export interface CommunityResult {
  id: string;
  members: string[];
  label: string;
  cohesion: number;
}

export interface CentralityResult {
  mostConnected: { nodeId: string; inDegree: number; outDegree: number; score: number }[];
  highCoupling: { nodeId: string; connections: number }[];
  godNodes: { nodeId: string; reason: string }[];
}

/**
 * Deterministic connected components via sorted BFS. Seed is fixed (no randomness).
 */
export function detectCommunities(nodes: GraphNode[], edges: GraphEdge[]): CommunityResult[] {
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const e of edges) {
    if (!e.target) continue;
    if (!adj.has(e.source)) adj.set(e.source, new Set());
    if (!adj.has(e.target)) adj.set(e.target, new Set());
    adj.get(e.source)!.add(e.target);
    adj.get(e.target)!.add(e.source);
  }

  const sortedNodeIds = Array.from(adj.keys()).sort();
  const visited = new Set<string>();
  const communities: CommunityResult[] = [];
  let communityIndex = 0;

  for (const start of sortedNodeIds) {
    if (visited.has(start)) continue;
    const queue: string[] = [start];
    const members: string[] = [];
    visited.add(start);
    // BFS deterministic: sort neighbors
    while (queue.length) {
      const cur = queue.shift()!;
      members.push(cur);
      const neighbors = Array.from(adj.get(cur) ?? []).sort();
      for (const nb of neighbors) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    members.sort();
    const cohesion = members.length > 1 ? Math.min(1, (members.length / nodes.length) * 2) : 0;
    communities.push({
      id: `community:${communityIndex}`,
      members,
      label: `Community ${communityIndex + 1} (${members.length} nodes)`,
      cohesion: Math.round(cohesion * 100) / 100,
    });
    communityIndex++;
  }

  // Sort communities deterministically by size desc then id
  communities.sort((a, b) => b.members.length - a.members.length || a.id.localeCompare(b.id));
  return communities;
}

export function detectDependencyCycles(edges: GraphEdge[]): string[][] {
  // Build directed graph from DEPENDS_ON, IMPORTS, CALLS edges
  const graph = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!e.target) continue;
    if (!['DEPENDS_ON', 'IMPORTS', 'CALLS'].includes(e.type)) continue;
    if (!graph.has(e.source)) graph.set(e.source, new Set());
    graph.get(e.source)!.add(e.target);
  }
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const active = new Set<string>();
  const path: string[] = [];

  function dfs(node: string) {
    if (active.has(node)) {
      const idx = path.indexOf(node);
      if (idx !== -1) cycles.push(path.slice(idx));
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    active.add(node);
    path.push(node);
    const neighbors = Array.from(graph.get(node) ?? []).sort();
    for (const nb of neighbors) dfs(nb);
    path.pop();
    active.delete(node);
  }

  const sortedNodes = Array.from(graph.keys()).sort();
  for (const n of sortedNodes) dfs(n);
  // Deterministic dedup and sort
  const seen = new Set<string>();
  const unique: string[][] = [];
  for (const cycle of cycles) {
    const key = [...cycle].sort().join('|');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push([...cycle].sort());
    }
  }
  unique.sort((a, b) => a.join(',').localeCompare(b.join(',')));
  return unique.slice(0, 20);
}

export function detectCentrality(nodes: GraphNode[], edges: GraphEdge[]): CentralityResult {
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    outDegree.set(n.id, 0);
  }
  for (const e of edges) {
    if (!e.target) continue;
    outDegree.set(e.source, (outDegree.get(e.source) ?? 0) + 1);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  const scored = nodes
    .map((n) => ({
      nodeId: n.id,
      inDegree: inDegree.get(n.id) ?? 0,
      outDegree: outDegree.get(n.id) ?? 0,
      score: (inDegree.get(n.id) ?? 0) + (outDegree.get(n.id) ?? 0),
    }))
    .sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId));

  const mostConnected = scored.slice(0, 10);
  const highCoupling = scored.filter((s) => s.score > 20).slice(0, 10).map((s) => ({ nodeId: s.nodeId, connections: s.score }));
  const godNodes = scored
    .filter((s) => s.score > 30)
    .slice(0, 5)
    .map((s) => ({ nodeId: s.nodeId, reason: `High coupling: ${s.inDegree} in / ${s.outDegree} out` }));

  return { mostConnected, highCoupling, godNodes };
}

export function traceBlastRadius(startNodeId: string, edges: GraphEdge[], direction: 'upstream' | 'downstream' | 'both' = 'both', maxDepth = 5, maxNodes = 100): Set<string> {
  const adjOut = new Map<string, Set<string>>();
  const adjIn = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!e.target) continue;
    if (!adjOut.has(e.source)) adjOut.set(e.source, new Set());
    if (!adjIn.has(e.target)) adjIn.set(e.target, new Set());
    adjOut.get(e.source)!.add(e.target);
    adjIn.get(e.target)!.add(e.source);
  }

  const visited = new Set<string>([startNodeId]);
  const queue: { id: string; depth: number }[] = [{ id: startNodeId, depth: 0 }];

  while (queue.length && visited.size < maxNodes) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;
    const neighbors: string[] = [];
    if (direction === 'downstream' || direction === 'both') neighbors.push(...Array.from(adjOut.get(id) ?? []));
    if (direction === 'upstream' || direction === 'both') neighbors.push(...Array.from(adjIn.get(id) ?? []));
    neighbors.sort();
    for (const nb of neighbors) {
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push({ id: nb, depth: depth + 1 });
      }
      if (visited.size >= maxNodes) break;
    }
  }
  return visited;
}

export function shortestPath(source: string, target: string, edges: GraphEdge[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!e.target) continue;
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  // Deterministic BFS
  for (const list of adj.values()) list.sort();
  const queue: string[][] = [[source]];
  const visited = new Set<string>([source]);
  while (queue.length) {
    const path = queue.shift()!;
    const last = path[path.length - 1];
    if (last === target) return path;
    for (const nb of adj.get(last) ?? []) {
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push([...path, nb]);
      }
    }
  }
  return null;
}
