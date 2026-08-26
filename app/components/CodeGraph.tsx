'use client';

/**
 * Technical Code Graph explorer.
 *
 * Renders an expandable subgraph of the canonical v2 graph (or a v1.1 artifact
 * adapted without fabricated evidence). Starts from a focused, highest-degree
 * subgraph and expands neighborhoods on demand so large repositories never
 * render their entire graph at once.
 *
 * The constellation is alive: a continuous force simulation runs in a
 * requestAnimationFrame loop with alpha cooling (Obsidian-style), dragging a
 * node reheats the simulation while its neighbors react, and hovering a node
 * or edge highlights its direct neighborhood and dims everything else.
 */

import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { adaptV1ToV2Viewer } from '../lib/schema/artifact-loader';
import type { RepoDNAProject } from '../lib/types';
import type { GraphEdge, RepoDNAProjectV2, GraphNode } from '../lib/analyzer/v2/types';

const INITIAL_NODE_LIMIT = 80;
const EXPAND_LIMIT = 24;
const MAX_RENDERED_EDGE_LIMIT = 240;

const kindTone: Record<string, string> = {
  repository: '#e879f9',
  workspace: '#c084fc',
  package: '#a78bfa',
  directory: '#7dd3fc',
  module: '#38bdf8',
  file: '#0ea5e9',
  class: '#fbbf24',
  interface: '#fcd34d',
  function: '#4ade80',
  method: '#34d399',
  attribute: '#a3a3a3',
  variable: '#94a3b8',
  route: '#22d3ee',
  controller: '#818cf8',
  service: '#f59e0b',
  repository_layer: '#60a5fa',
  component: '#fb7185',
  data_model: '#2dd4bf',
  table: '#14b8a6',
  dependency: '#9ca3af',
  configuration: '#d4d4d8',
  external_system: '#f472b6',
};

const edgeTypeTone: Record<string, string> = {
  CONTAINS: '#64748b',
  DEFINES: '#475569',
  IMPORTS: '#38bdf8',
  CALLS: '#4ade80',
  INHERITS: '#fbbf24',
  IMPLEMENTS: '#fcd34d',
  READS: '#2dd4bf',
  WRITES: '#14b8a6',
  EXPOSES_ROUTE: '#22d3ee',
  HANDLES: '#818cf8',
  INVOKES: '#f59e0b',
  DEPENDS_ON: '#9ca3af',
  CONFIGURES: '#d4d4d8',
};

type CodeGraphNodeData = {
  label: string;
  kind: string;
  path: string;
  language: string;
  degree: number;
  color: string;
  dim: boolean;
  hot: boolean;
};

type CodeGraphEdgeData = {
  edgeId: string;
  relation: string;
  status: string;
  confidence: number;
  explanation: string;
  evidenceFile: string;
  evidenceRange: string;
  resolverName: string;
  alternatives: string[];
  unresolvedExpression: string | null;
};

type GraphPoint = { x: number; y: number };
type Side = 'n' | 'e' | 's' | 'w';

function normalizeProject(project: RepoDNAProject | RepoDNAProjectV2): RepoDNAProjectV2 {
  if ((project as RepoDNAProjectV2).schemaVersion === '2.0.0') return project as RepoDNAProjectV2;
  return adaptV1ToV2Viewer(project as RepoDNAProject);
}

function shortLabel(node: GraphNode): string {
  const q = node.qualifiedName || node.name || node.path;
  return q.length > 28 ? q.slice(0, 27) + '…' : q;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

/**
 * Deterministic initializer for the live simulation. The same repository and
 * filter combination always starts from the same constellation; from there the
 * rAF loop takes over with alpha cooling.
 */
function initSimulation(nodes: GraphNode[], edges: GraphEdge[], seed: number): Map<string, GraphPoint> {
  const positions = new Map<string, GraphPoint>();
  const velocities = new Map<string, GraphPoint>();
  const nodeIds = new Set(nodes.map((node) => node.id));
  const degree = new Map<string, number>();

  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) continue;
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    if (edge.target && nodeIds.has(edge.target)) degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  const ranked = [...nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id));
  const centerId = ranked[0]?.id;
  for (const node of nodes) {
    const rank = ranked.findIndex((candidate) => candidate.id === node.id);
    const angle = rank * 2.399963 + hashSeed(`${seed}:${node.id}:angle`) * 0.45;
    const radius = centerId === node.id
      ? 0
      : 260 + Math.sqrt(rank + 1) * 105 + hashSeed(`${seed}:${node.id}:radius`) * 120;
    positions.set(node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    velocities.set(node.id, { x: 0, y: 0 });
  }

  const visibleEdges = edges.filter((edge) => edge.target && nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const iterations = Math.min(140, Math.max(90, 70 + Math.floor(nodes.length * 0.75)));
  for (let iteration = 0; iteration < iterations; iteration++) {
    const temperature = 1 - iteration / iterations;
    const forces = new Map<string, GraphPoint>(nodes.map((node) => [node.id, { x: 0, y: 0 }]));

    for (let i = 0; i < nodes.length; i++) {
      const left = nodes[i];
      const leftPoint = positions.get(left.id)!;
      for (let j = i + 1; j < nodes.length; j++) {
        const right = nodes[j];
        const rightPoint = positions.get(right.id)!;
        let dx = leftPoint.x - rightPoint.x;
        let dy = leftPoint.y - rightPoint.y;
        const distanceSquared = Math.max(dx * dx + dy * dy, 900);
        const distance = Math.sqrt(distanceSquared);
        dx /= distance;
        dy /= distance;
        const collision = distance < 180 ? (180 - distance) * 1.4 : 0;
        const repel = Math.min(900, 150000 / distanceSquared + collision);
        forces.get(left.id)!.x += dx * repel;
        forces.get(left.id)!.y += dy * repel;
        forces.get(right.id)!.x -= dx * repel;
        forces.get(right.id)!.y -= dy * repel;
      }
    }

    for (const edge of visibleEdges) {
      const source = positions.get(edge.source)!;
      const target = positions.get(edge.target!)!;
      let dx = target.x - source.x;
      let dy = target.y - source.y;
      const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      dx /= distance;
      dy /= distance;
      const spring = Math.max(-220, Math.min(220, (distance - 360) * 0.006));
      forces.get(edge.source)!.x += dx * spring;
      forces.get(edge.source)!.y += dy * spring;
      forces.get(edge.target!)!.x -= dx * spring;
      forces.get(edge.target!)!.y -= dy * spring;
    }

    for (const node of nodes) {
      const point = positions.get(node.id)!;
      const force = forces.get(node.id)!;
      const velocity = velocities.get(node.id)!;
      force.x -= point.x * 0.0007;
      force.y -= point.y * 0.0007;
      velocity.x = (velocity.x + force.x * 0.038) * 0.84;
      velocity.y = (velocity.y + force.y * 0.038) * 0.84;
      const maxStep = 16 * temperature + 1;
      const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y) || 1;
      const step = Math.min(1, maxStep / speed);
      point.x += velocity.x * step;
      point.y += velocity.y * step;
    }
  }

  return positions;
}

/** One integration tick of the live simulation. Mutates points/velocities/alpha in place; returns true when anything moved. */
function stepSimulation(
  points: Map<string, GraphPoint>,
  springs: Array<{ a: string; b: string }>,
  ids: string[],
  velocities: Map<string, GraphPoint>,
  state: { alpha: number },
  pinned: Set<string> | null
): boolean {
  if (state.alpha <= 0.004 && !pinned) return false;

  const nodes = ids.filter((id) => points.has(id));
  const forces = new Map<string, GraphPoint>(nodes.map((id) => [id, { x: 0, y: 0 }]));
  const dragBoost = pinned ? 1.35 : 1;

  for (let i = 0; i < nodes.length; i++) {
    const leftId = nodes[i];
    const leftPoint = points.get(leftId)!;
    for (let j = i + 1; j < nodes.length; j++) {
      const rightId = nodes[j];
      const rightPoint = points.get(rightId)!;
      let dx = leftPoint.x - rightPoint.x;
      let dy = leftPoint.y - rightPoint.y;
      const distanceSquared = Math.max(dx * dx + dy * dy, 900);
      const distance = Math.sqrt(distanceSquared);
      dx /= distance;
      dy /= distance;
      const collision = distance < 170 ? (170 - distance) * 1.5 : 0;
      const repel = Math.min(950, (160000 / distanceSquared + collision) * dragBoost);
      forces.get(leftId)!.x += dx * repel;
      forces.get(leftId)!.y += dy * repel;
      forces.get(rightId)!.x -= dx * repel;
      forces.get(rightId)!.y -= dy * repel;
    }
  }

  for (const edge of springs) {
    const source = points.get(edge.a);
    const target = points.get(edge.b);
    if (!source || !target) continue;
    let dx = target.x - source.x;
    let dy = target.y - source.y;
    const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
    dx /= distance;
    dy /= distance;
    const spring = Math.max(-240, Math.min(240, (distance - 360) * 0.007));
    forces.get(edge.a)!.x += dx * spring;
    forces.get(edge.a)!.y += dy * spring;
    forces.get(edge.b)!.x -= dx * spring;
    forces.get(edge.b)!.y -= dy * spring;
  }

  let moved = false;
  for (const id of nodes) {
    if (pinned?.has(id)) continue;
    const point = points.get(id)!;
    const force = forces.get(id)!;
    const velocity = velocities.get(id);
    if (!velocity) continue;
    force.x -= point.x * 0.0008;
    force.y -= point.y * 0.0008;
    velocity.x = (velocity.x + force.x * 0.04) * 0.85;
    velocity.y = (velocity.y + force.y * 0.04) * 0.85;
    const maxStep = 15 * state.alpha + 0.6;
    const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y) || 1;
    const stepScale = Math.min(1, maxStep / speed);
    const nextX = point.x + velocity.x * stepScale;
    const nextY = point.y + velocity.y * stepScale;
    if (Math.abs(nextX - point.x) > 0.02 || Math.abs(nextY - point.y) > 0.02) moved = true;
    point.x = nextX;
    point.y = nextY;
  }

  state.alpha *= pinned ? 0.999 : 0.978;
  if (state.alpha <= 0.004) state.alpha = 0;
  return moved;
}

function buildSprings(edges: GraphEdge[], visibleIds: Set<string>): Array<{ a: string; b: string }> {
  const springs: Array<{ a: string; b: string }> = [];
  for (const edge of edges) {
    if (!edge.target || edge.target === edge.source) continue;
    if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) continue;
    springs.push({ a: edge.source, b: edge.target });
  }
  return springs;
}

function buildNeighborhood(edges: GraphEdge[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    let set = map.get(a);
    if (!set) map.set(a, (set = new Set()));
    set.add(b);
  };
  for (const edge of edges) {
    if (!edge.target || edge.target === edge.source) continue;
    link(edge.source, edge.target);
    link(edge.target, edge.source);
  }
  return map;
}

function spawnPoint(id: string, adjacency: Map<string, Set<string>>, pos: Map<string, GraphPoint>, index: number): GraphPoint {
  for (const neighbor of adjacency.get(id) ?? []) {
    const base = pos.get(neighbor);
    if (base) {
      const angle = index * 2.399963 + hashSeed(`${id}:spawn`) * 1.2;
      const radius = 120 + hashSeed(`${id}:spawn:r`) * 90;
      return { x: base.x + Math.cos(angle) * radius, y: base.y + Math.sin(angle) * radius };
    }
  }
  const fallbackAngle = index * 2.399963 + hashSeed(`${id}:spawn`) * 0.45;
  const fallbackRadius = 260 + Math.sqrt(index + 1) * 105 + hashSeed(`${id}:spawn:r`) * 120;
  return { x: Math.cos(fallbackAngle) * fallbackRadius, y: Math.sin(fallbackAngle) * fallbackRadius };
}

function pickSides(a: GraphPoint, b: GraphPoint): { s: Side; t: Side } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { s: dx >= 0 ? 'e' : 'w', t: dx >= 0 ? 'w' : 'e' };
  return { s: dy >= 0 ? 's' : 'n', t: dy >= 0 ? 'n' : 's' };
}

function edgePriority(edge: GraphEdge, degreeById: Map<string, number>): number {
  const statusScore = edge.status === 'resolved' ? 3 : edge.status === 'ambiguous' ? 2 : 1;
  const relationScore: Record<string, number> = {
    EXPOSES_ROUTE: 8,
    HANDLES: 8,
    READS: 7,
    WRITES: 7,
    CALLS: 6,
    INVOKES: 6,
    IMPORTS: 5,
    DEPENDS_ON: 5,
    INHERITS: 4,
    IMPLEMENTS: 4,
    DEFINES: 3,
    CONTAINS: 2,
    CONFIGURES: 2,
  };
  const endpointDegree = (degreeById.get(edge.source) ?? 0) + (edge.target ? degreeById.get(edge.target) ?? 0 : 0);
  return statusScore * 10000 + (relationScore[edge.type] ?? 1) * 1000 + endpointDegree * 10 + edge.confidence;
}

function selectRenderedEdges(edges: GraphEdge[], limit: number, degreeById: Map<string, number>): GraphEdge[] {
  if (edges.length <= limit) return edges;

  const ranked = edges
    .map((edge, index) => ({ edge, index, score: edgePriority(edge, degreeById) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit);

  // Preserve source order so a re-layout never changes edge identity/order
  // just because the ranking tie-breaker changed.
  return ranked.sort((a, b) => a.index - b.index).map(({ edge }) => edge);
}

function graphMiniMapNodeColor(node: Node): string {
  const color = (node.data as Partial<CodeGraphNodeData>).color;
  return typeof color === 'string' ? color : '#38bdf8';
}

function buildCodeNode(
  node: GraphNode,
  position: GraphPoint,
  degrees: Map<string, number>
): Node<CodeGraphNodeData> {
  return {
    id: node.id,
    position: { x: position.x, y: position.y },
    initialWidth: 48,
    initialHeight: 48,
    data: {
      label: shortLabel(node),
      kind: node.kind,
      path: node.path,
      language: node.language,
      degree: degrees.get(node.id) ?? 0,
      color: kindTone[node.kind] ?? '#9ca3af',
      dim: false,
      hot: false,
    },
    type: 'codegraph' as const,
  };
}

function nodeDataEqual(a: CodeGraphNodeData, b: CodeGraphNodeData): boolean {
  return (
    a.label === b.label &&
    a.kind === b.kind &&
    a.path === b.path &&
    a.language === b.language &&
    a.degree === b.degree &&
    a.color === b.color
  );
}

export function CodeGraph({ project }: { project: RepoDNAProject | RepoDNAProjectV2 }) {
  const graph = useMemo(() => normalizeProject(project), [project]);
  const [resetKey, setResetKey] = useState(0);
  const [layoutSeed, setLayoutSeed] = useState(0);
  const sig = `${resetKey}:${layoutSeed}`;

  const [granularity, setGranularity] = useState<'structure' | 'symbols'>('structure');
  const [search, setSearch] = useState('');
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const [relationFilter, setRelationFilter] = useState<'all' | 'imports_calls' | 'data' | 'routes'>('all');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  const structureKinds = useMemo(() => new Set(['repository', 'workspace', 'package', 'directory', 'module', 'file', 'route', 'data_model', 'table', 'dependency', 'configuration', 'external_system']), []);
  const symbolKinds = useMemo(() => new Set(['class', 'interface', 'function', 'method', 'controller', 'service', 'repository_layer', 'component', 'attribute', 'variable']), []);

  const filteredEdges = useMemo(() => {
    let edges = graph.edges;
    if (unresolvedOnly) edges = edges.filter((e) => e.status === 'unresolved' || e.status === 'ambiguous');
    if (relationFilter !== 'all') {
      const groups: Record<string, Set<string>> = {
        imports_calls: new Set(['IMPORTS', 'CALLS', 'INVOKES', 'DEPENDS_ON']),
        data: new Set(['READS', 'WRITES']),
        routes: new Set(['EXPOSES_ROUTE', 'HANDLES']),
      };
      const allowed = groups[relationFilter];
      edges = edges.filter((e) => allowed.has(e.type));
    }
    return edges;
  }, [graph.edges, unresolvedOnly, relationFilter]);

  const degreeById = useMemo(() => {
    const deg = new Map<string, number>();
    for (const e of filteredEdges) {
      deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
      if (e.target) deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
    }
    return deg;
  }, [filteredEdges]);

  /**
   * Deterministic visible-node selection:
   * seed = top-degree nodes matching filters/search; plus expanded neighborhoods.
   */
  const visibleNodes = useMemo(() => {
    let candidates = graph.nodes.filter((n) =>
      granularity === 'structure' ? structureKinds.has(n.kind) : symbolKinds.has(n.kind)
    );
    const q = search.trim().toLowerCase();
    if (q) {
      candidates = candidates.filter(
        (n) => n.qualifiedName.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)
      );
    }

    const ranked = [...candidates].sort((a, b) => {
      const da = degreeById.get(a.id) ?? 0;
      const dbv = degreeById.get(b.id) ?? 0;
      return dbv - da || a.id.localeCompare(b.id);
    });

    const selected = new Map<string, GraphNode>();
    for (const n of ranked.slice(0, INITIAL_NODE_LIMIT)) selected.set(n.id, n);

    for (const expandId of expandedIds) {
      if (!selected.has(expandId)) continue;
      const neighbors: string[] = [];
      for (const e of filteredEdges) {
        if (e.source === expandId && e.target) neighbors.push(e.target);
        if (e.target === expandId) neighbors.push(e.source);
      }
      for (const nbId of neighbors.sort().slice(0, EXPAND_LIMIT)) {
        const nb = graph.nodes.find((n) => n.id === nbId);
        if (nb && !selected.has(nbId)) {
          // Respect granularity only loosely on expansion (neighbors may be symbols).
          selected.set(nbId, nb);
        }
      }
    }

    if (selectedNodeId && !selected.has(selectedNodeId)) {
      const n = graph.nodes.find((x) => x.id === selectedNodeId);
      if (n) selected.set(n.id, n);
    }
    return Array.from(selected.values());
  }, [graph.nodes, filteredEdges, granularity, structureKinds, symbolKinds, search, degreeById, expandedIds, selectedNodeId]);

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);

  const candidateEdges = useMemo(
    () => filteredEdges.filter((e) => visibleNodeIds.has(e.source) && (!e.target || visibleNodeIds.has(e.target))),
    [filteredEdges, visibleNodeIds]
  );

  const renderedEdges = useMemo(
    () => selectRenderedEdges(candidateEdges, MAX_RENDERED_EDGE_LIMIT, degreeById),
    [candidateEdges, degreeById]
  );

  const [rfNodes, setRfNodes] = useState<Node<CodeGraphNodeData>[]>(() => {
    const pos = initSimulation(visibleNodes, candidateEdges, layoutSeed);
    return visibleNodes.map((n) => buildCodeNode(n, pos.get(n.id) ?? { x: 0, y: 0 }, degreeById));
  });

  const wakeRef = useRef<() => void>(() => {});
  const pinnedRef = useRef<Set<string> | null>(null);
  const adjacencyRef = useRef<Map<string, Set<string>>>(new Map());
  const springRef = useRef<Array<{ a: string; b: string }>>([]);
  const velRef = useRef<Map<string, GraphPoint>>(new Map());
  const alphaRef = useRef({ alpha: 1 });
  const simIdsRef = useRef<string[]>([]);
  const latestNodesRef = useRef<Node<CodeGraphNodeData>[]>(rfNodes);
  const builtSigRef = useRef<string | null>(null);

  const reheat = useCallback((alpha: number) => {
    alphaRef.current.alpha = Math.max(alphaRef.current.alpha, alpha);
    wakeRef.current();
  }, []);

  useEffect(() => {
    adjacencyRef.current = buildNeighborhood(candidateEdges);
    springRef.current = buildSprings(candidateEdges, visibleNodeIds);
    simIdsRef.current = [...visibleNodeIds];
  }, [candidateEdges, visibleNodeIds]);

  useEffect(() => {
    latestNodesRef.current = rfNodes;
  }, [rfNodes]);

  useEffect(() => {
    if (builtSigRef.current !== sig) {
      builtSigRef.current = sig;
      const pos = initSimulation(visibleNodes, candidateEdges, layoutSeed);
      velRef.current = new Map([...pos.keys()].map((id) => [id, { x: 0, y: 0 }]));
      alphaRef.current = { alpha: 1 };
      setRfNodes(visibleNodes.map((n) => buildCodeNode(n, pos.get(n.id) ?? { x: 0, y: 0 }, degreeById)));
      reheat(0.9);
      return;
    }

    const aliveIds = new Set(visibleNodes.map((n) => n.id));
    let removed = false;
    for (const id of [...velRef.current.keys()]) {
      if (!aliveIds.has(id)) {
        velRef.current.delete(id);
        removed = true;
      }
    }
    let spawned = 0;
    const currentPositions = new Map<string, GraphPoint>(
      latestNodesRef.current.map((n) => [n.id, { x: n.position.x, y: n.position.y }])
    );
    const spawnPositions = new Map<string, GraphPoint>();
    visibleNodes.forEach((n, index) => {
      if (!currentPositions.has(n.id)) {
        spawnPositions.set(n.id, spawnPoint(n.id, adjacencyRef.current, currentPositions, index));
        velRef.current.set(n.id, { x: 0, y: 0 });
        spawned++;
      }
    });

    setRfNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return visibleNodes.map((n) => {
        const existing = byId.get(n.id);
        const spawn = spawnPositions.get(n.id);
        const position = spawn ?? (existing ? existing.position : { x: 0, y: 0 });
        const desired = buildCodeNode(n, position, degreeById);
        if (existing && nodeDataEqual(existing.data, desired.data)) return existing;
        return desired;
      });
    });
    if (spawned > 0 || removed) reheat(spawned > 0 ? 0.85 : 0.5);
  }, [visibleNodes, candidateEdges, degreeById, sig, layoutSeed, reheat]);

  useEffect(() => {
    let frame = 0;
    let sleeping = false;

    const tick = () => {
      const pinned = pinnedRef.current;
      const points = new Map<string, GraphPoint>(
        latestNodesRef.current.map((n) => [n.id, { x: n.position.x, y: n.position.y }])
      );
      const moved = stepSimulation(points, springRef.current, simIdsRef.current, velRef.current, alphaRef.current, pinned);
      if (moved) {
        setRfNodes((prev) => {
          let changed = false;
          const next = prev.map((n) => {
            if (pinned?.has(n.id)) return n;
            const p = points.get(n.id);
            if (!p) return n;
            if (Math.abs(p.x - n.position.x) > 0.02 || Math.abs(p.y - n.position.y) > 0.02) {
              changed = true;
              return { ...n, position: { x: p.x, y: p.y } };
            }
            return n;
          });
          return changed ? next : prev;
        });
      }
      if (alphaRef.current.alpha <= 0 && !pinned) {
        sleeping = true;
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    wakeRef.current = () => {
      if (!sleeping) return;
      sleeping = false;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      sleeping = true;
      cancelAnimationFrame(frame);
      wakeRef.current = () => {};
    };
  }, [sig]);

  const onNodesChange = useCallback((changes: NodeChange<Node<CodeGraphNodeData>>[]) => {
    setRfNodes((prev) => applyNodeChanges(changes, prev));
  }, []);

  const onNodeDragStart = useCallback(
    (_: unknown, node: Node<CodeGraphNodeData>) => {
      pinnedRef.current = new Set([node.id]);
      reheat(0.35);
    },
    [reheat]
  );

  const onNodeDragStop = useCallback(
    () => {
      pinnedRef.current = null;
      reheat(0.28);
    },
    [reheat]
  );

  const neighborhood = useMemo(() => buildNeighborhood(renderedEdges), [renderedEdges]);

  const focusIds = useMemo(() => {
    const hoveredEdge = hoveredEdgeId ? renderedEdges.find((e) => e.id === hoveredEdgeId) : null;
    const focusNode = hoveredNodeId ?? selectedNodeId;
    if (!hoveredEdge && !focusNode) return null;
    const ids = new Set<string>();
    const roots = hoveredEdge ? [hoveredEdge.source, ...(hoveredEdge.target ? [hoveredEdge.target] : [])] : [focusNode!];
    for (const root of roots) {
      ids.add(root);
      for (const neighbor of neighborhood.get(root) ?? []) ids.add(neighbor);
    }
    return ids;
  }, [hoveredNodeId, hoveredEdgeId, selectedNodeId, renderedEdges, neighborhood]);

  const decoratedNodes = useMemo(() => {
    return rfNodes.map((n) => {
      const isFocus = !!focusIds?.has(n.id);
      const dim = !!focusIds && !isFocus;
      const hot = isFocus || n.id === selectedNodeId;
      if (n.data.dim === dim && n.data.hot === hot) return n;
      return { ...n, data: { ...n.data, dim, hot } };
    });
  }, [rfNodes, focusIds, selectedNodeId]);

  const rfEdges: Edge<CodeGraphEdgeData>[] = useMemo(() => {
    const unresolved = (status: string) => status === 'unresolved' || status === 'ambiguous';
    const pointById = new Map(rfNodes.map((n) => [n.id, n.position]));
    return renderedEdges.flatMap((e) => {
      if (!e.target || e.target === e.source || !visibleNodeIds.has(e.source) || !visibleNodeIds.has(e.target)) return [];
      const a = pointById.get(e.source);
      const b = pointById.get(e.target);
      const sides = a && b ? pickSides(a, b) : { s: 'r' as Side, t: 'l' as Side };
      const hot = !!focusIds?.has(e.source) && !!focusIds.has(e.target);
      const dim = !!focusIds && !hot;
      const stroke = edgeTypeTone[e.type] ?? '#94a3b8';
      return [{
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: `s-${sides.s}`,
        targetHandle: `t-${sides.t}`,
        type: 'straight',
        animated: false,
        className: `${dim ? 'eg-dim' : hot ? 'eg-hot' : 'eg-idle'}${unresolved(e.status) ? ' eg-unresolved' : ''}`,
        style: { stroke },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 16, height: 16 },
        data: {
          edgeId: e.id,
          relation: e.type,
          status: e.status,
          confidence: e.confidence,
          explanation: e.explanation,
          evidenceFile: e.evidence.file,
          evidenceRange: `${e.evidence.range.startLine}:${e.evidence.range.startCol}-${e.evidence.range.endLine}:${e.evidence.range.endCol}`,
          resolverName: e.resolver.name,
          alternatives: e.alternativeCandidates ?? [],
          unresolvedExpression: e.unresolvedExpression ?? null,
        },
      }];
    });
  }, [renderedEdges, visibleNodeIds, focusIds, rfNodes]);

  const selectedNode = graph.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = graph.edges.find((e) => e.id === selectedEdgeId) ?? null;

  const onNodeClick = useCallback((_: unknown, node: Node<CodeGraphNodeData>) => {
    setSelectedEdgeId(null);
    setSelectedNodeId((prev) => (prev === node.id ? prev : node.id));
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.add(node.id);
      return next;
    });
  }, []);

  const onEdgeClick = useCallback((_: unknown, edge: Edge<CodeGraphEdgeData>) => {
    setSelectedEdgeId(edge.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  function resetView() {
    setExpandedIds(new Set());
    setSearch('');
    setUnresolvedOnly(false);
    setRelationFilter('all');
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setHoveredNodeId(null);
    setHoveredEdgeId(null);
    setResetKey((k) => k + 1);
    setLayoutSeed((k) => k + 1);
  }

  const candidateNodeCount = graph.nodes.filter((n) => (granularity === 'structure' ? structureKinds : symbolKinds).has(n.kind)).length;
  const nodesTruncated = visibleNodes.length < candidateNodeCount;
  const edgesTruncated = renderedEdges.length < candidateEdges.length;

  return (
    <div className="code-graph-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 480 }}>
      <section className="view-heading code-graph-heading">
        <div>
          <p className="eyebrow cyan-text">Relationship explorer</p>
          <h1>Code Graph</h1>
          <p>Explore the repository as a living constellation. Drag nodes to pull the web around, hover to trace neighborhoods, click to expand.</p>
        </div>
        <div className="view-heading-actions">
          <span>{graph.nodes.length} entities · {graph.edges.length} relationships</span>
          <button className="export-pill-btn" onClick={() => setLayoutSeed((k) => k + 1)} type="button">Re-layout</button>
        </div>
      </section>
      <div className="code-graph-controls" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <input
          className="search-input"
          placeholder="Search entities or paths…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: '6px 10px', background: 'rgba(6,9,13,0.8)', border: '1px solid var(--line)', borderRadius: 8, color: 'inherit', minWidth: 200 }}
          aria-label="Search graph entities"
        />
        <select value={granularity} onChange={(e) => setGranularity(e.target.value as 'structure' | 'symbols')} aria-label="Entity granularity" className="chip-button">
          <option value="structure">Structure</option>
          <option value="symbols">Symbols</option>
        </select>
        <select value={relationFilter} onChange={(e) => setRelationFilter(e.target.value as typeof relationFilter)} aria-label="Relationship filter" className="chip-button">
          <option value="all">All relations</option>
          <option value="imports_calls">Imports & calls</option>
          <option value="data">Reads / writes</option>
          <option value="routes">Routes</option>
        </select>
        <button className={`chip-button ${unresolvedOnly ? 'active' : ''}`} onClick={() => setUnresolvedOnly((v) => !v)} type="button">
          Unresolved only
        </button>
        <button className="chip-button" onClick={resetView} type="button">Reset view</button>
        <span style={{ opacity: 0.65, fontSize: 12 }} role="status">
          {visibleNodes.length}{nodesTruncated ? ` of ${candidateNodeCount}` : ''} nodes · {renderedEdges.length}{edgesTruncated ? ` of ${candidateEdges.length}` : ''} edges shown · drag nodes, click to expand
        </span>
      </div>

      <div style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', minHeight: 420 }}>
        <ReactFlow
          key={resetKey}
          nodes={decoratedNodes}
          edges={rfEdges}
          nodeTypes={codeGraphNodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
          onNodeMouseLeave={() => setHoveredNodeId(null)}
          onEdgeMouseEnter={(_, edge) => setHoveredEdgeId(edge.id)}
          onEdgeMouseLeave={() => setHoveredEdgeId(null)}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          fitView
          fitViewOptions={{ padding: 0.22 }}
          minZoom={0.05}
          maxZoom={2.5}
          nodeOrigin={[0.5, 0.5]}
          nodeDragThreshold={2}
          nodesConnectable={false}
          deleteKeyCode={null}
          edgesFocusable={false}
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background bgColor="#06090d" color="#142633" gap={36} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            ariaLabel="Code graph navigator. Drag to pan, scroll to zoom, or select a node."
            bgColor="#081018"
            maskColor="rgba(6, 12, 18, 0.74)"
            maskStrokeColor="#4ce1f5"
            maskStrokeWidth={1.5}
            nodeBorderRadius={5}
            nodeColor={graphMiniMapNodeColor}
            nodeStrokeColor="#dffbff"
            nodeStrokeWidth={2}
            offsetScale={2}
            pannable
            style={{ background: '#081018' }}
            zoomStep={0.5}
            zoomable
          />
        </ReactFlow>
      </div>

      <div className="code-graph-legend" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8, fontSize: 11, opacity: 0.85 }}>
        {[...new Set(visibleNodes.map((n) => n.kind))].sort().map((k) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: kindTone[k] ?? '#9ca3af', display: 'inline-block' }} />
            {k.replace('_', ' ')}
          </span>
        ))}
        <span>— dashed = unresolved/ambiguous</span>
      </div>

      {selectedEdge && (
        <aside className="graph-evidence-drawer" aria-label="Why are these connected" style={{ marginTop: 10, border: '1px solid var(--line)', borderRadius: 12, padding: '12px 16px', background: 'rgba(6,9,13,0.92)' }}>
          <h4 style={{ margin: '0 0 6px', color: 'var(--cyan)' }}>Why are these connected?</h4>
          <p style={{ margin: '0 0 4px', fontSize: 13 }}>
            <strong>{selectedEdge.type}</strong> ({selectedEdge.status}, confidence {Math.round(selectedEdge.confidence * 100)}%)
          </p>
          <p style={{ margin: '0 0 4px', fontSize: 13 }}>{selectedEdge.explanation}</p>
          <p style={{ margin: 0, fontSize: 12, fontFamily: 'var(--font-geist-mono)', opacity: 0.85 }}>
            Evidence: {selectedEdge.evidence.file}:{selectedEdge.evidence.range.startLine}:{selectedEdge.evidence.range.startCol}-{selectedEdge.evidence.range.endLine}:{selectedEdge.evidence.range.endCol}
            {' '}· resolver {selectedEdge.resolver.name}@{selectedEdge.resolver.version}
          </p>
          {selectedEdge.unresolvedExpression && (
            <p style={{ margin: '6px 0 0', fontSize: 12, fontFamily: 'var(--font-geist-mono)', color: '#fbbf24' }}>
              Unresolved expression: {selectedEdge.unresolvedExpression}
            </p>
          )}
          {(selectedEdge.alternativeCandidates?.length ?? 0) > 0 && (
            <p style={{ margin: '4px 0 0', fontSize: 12, opacity: 0.8 }}>
              Alternative candidates: {selectedEdge.alternativeCandidates!.join(', ')}
            </p>
          )}
          <button className="chip-button" style={{ marginTop: 8 }} onClick={() => setSelectedEdgeId(null)} type="button">Close</button>
        </aside>
      )}

      {selectedNode && !selectedEdge && (
        <aside aria-label="Node details" style={{ marginTop: 10, border: '1px solid var(--line)', borderRadius: 12, padding: '12px 16px', background: 'rgba(6,9,13,0.92)' }}>
          <h4 style={{ margin: '0 0 6px', color: 'var(--cyan)' }}>{selectedNode.qualifiedName}</h4>
          <p style={{ margin: 0, fontSize: 12, fontFamily: 'var(--font-geist-mono)', opacity: 0.85 }}>
            {selectedNode.kind} · {selectedNode.language || 'n/a'} · {selectedNode.path || '—'}:{selectedNode.range.startLine}
            {degreeById.get(selectedNode.id) ? ` · ${degreeById.get(selectedNode.id)} connections` : ''}
          </p>
          {(selectedNode.evidence?.length ?? 0) > 0 && (
            <p style={{ margin: '6px 0 0', fontSize: 12, opacity: 0.8 }}>Evidence: {selectedNode.evidence!.join(' · ')}</p>
          )}
        </aside>
      )}
    </div>
  );
}

const CodeGraphNode = memo(function CodeGraphNode({ data }: { data: CodeGraphNodeData }) {
  const classes = ['code-node'];
  if (data.dim) classes.push('is-dimmed');
  if (data.hot) classes.push('is-hot');
  return (
    <div
      className={classes.join(' ')}
      tabIndex={0}
      role="button"
      aria-label={data.path || data.label}
      style={{
        ['--node-color' as string]: data.color,
        ['--node-glow' as string]: `${data.color}66`,
        ['--node-glow-strong' as string]: `${data.color}aa`,
      }}
    >
      <span className="code-node-glyph" aria-hidden="true">
        {(data.label.replace(/[^a-zA-Z0-9]/g, '')[0] ?? '?').toUpperCase()}
      </span>
      <span className="code-node-caption" aria-hidden="true">
        <span className="code-node-title">{data.label}</span>
        <span className="code-node-kind">{data.kind.replace('_', ' ')}{data.degree ? ` · ${data.degree}` : ''}</span>
      </span>
      <Handle className="code-handle" id="t-n" type="target" position={Position.Top} />
      <Handle className="code-handle" id="t-e" type="target" position={Position.Right} />
      <Handle className="code-handle" id="t-s" type="target" position={Position.Bottom} />
      <Handle className="code-handle" id="t-w" type="target" position={Position.Left} />
      <Handle className="code-handle" id="s-n" type="source" position={Position.Top} />
      <Handle className="code-handle" id="s-e" type="source" position={Position.Right} />
      <Handle className="code-handle" id="s-s" type="source" position={Position.Bottom} />
      <Handle className="code-handle" id="s-w" type="source" position={Position.Left} />
    </div>
  );
});

const codeGraphNodeTypes = { codegraph: CodeGraphNode };
