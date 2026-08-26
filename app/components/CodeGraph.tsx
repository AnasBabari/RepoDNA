'use client';

/**
 * Technical Code Graph explorer.
 *
 * Renders an expandable subgraph of the canonical v2 graph (or a v1.1 artifact
 * adapted without fabricated evidence). Starts from a focused, highest-degree
 * subgraph and expands neighborhoods on demand so large repositories never
 * render their entire graph at once.
 */

import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { memo, useCallback, useMemo, useState } from 'react';

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
 * Small deterministic force solver for an Obsidian-like constellation layout.
 * Keeping this local avoids another graph-rendering dependency and makes the
 * first frame stable for the same repository/filter combination.
 */
function layoutForceGraph(nodes: GraphNode[], edges: GraphEdge[], seed: number): Map<string, GraphPoint> {
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
    // A deterministic spiral gives connected hubs room to breathe before the
    // force pass starts, which avoids the dense central knot on large repos.
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
      // Very light gravity keeps the constellation bounded without pulling
      // every connected neighborhood back into one central cluster.
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

export function CodeGraph({ project }: { project: RepoDNAProject | RepoDNAProjectV2 }) {
  const graph = useMemo(() => normalizeProject(project), [project]);
  const [resetKey, setResetKey] = useState(0);
  const [layoutSeed, setLayoutSeed] = useState(0);

  const [granularity, setGranularity] = useState<'structure' | 'symbols'>('structure');
  const [search, setSearch] = useState('');
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const [relationFilter, setRelationFilter] = useState<'all' | 'imports_calls' | 'data' | 'routes'>('all');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

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

    // Seed ranking: degree desc, then id asc (stable).
    const ranked = [...candidates].sort((a, b) => {
      const da = degreeById.get(a.id) ?? 0;
      const dbv = degreeById.get(b.id) ?? 0;
      return dbv - da || a.id.localeCompare(b.id);
    });

    const selected = new Map<string, GraphNode>();
    for (const n of ranked.slice(0, INITIAL_NODE_LIMIT)) selected.set(n.id, n);

    // Expand neighborhoods of user-expanded nodes.
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

  const layoutPositions = useMemo(
    () => layoutForceGraph(visibleNodes, candidateEdges, layoutSeed),
    [visibleNodes, candidateEdges, layoutSeed]
  );

  const rfNodes: Node<CodeGraphNodeData>[] = useMemo(() => {
    return visibleNodes.map((n) => {
      const position = layoutPositions.get(n.id) ?? { x: 0, y: 0 };
      return {
        id: n.id,
        position,
        data: {
          label: shortLabel(n),
          kind: n.kind,
          path: n.path,
          language: n.language,
          degree: degreeById.get(n.id) ?? 0,
          color: kindTone[n.kind] ?? '#9ca3af',
        },
        type: 'codegraph' as const,
      };
    });
  }, [visibleNodes, degreeById, layoutPositions]);

  const rfEdges: Edge<CodeGraphEdgeData>[] = useMemo(() => {
    return renderedEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target ?? e.source,
        type: 'straight',
        // Unresolved edges remain visibly dashed; animation adds continuous
        // paint work while zooming without adding useful information.
        animated: false,
        style: {
          stroke: edgeTypeTone[e.type] ?? '#94a3b8',
          strokeDasharray: e.status === 'unresolved' || e.status === 'ambiguous' ? '6 4' : undefined,
          opacity: e.status === 'resolved' ? 0.7 : 0.56,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeTypeTone[e.type] ?? '#94a3b8' },
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
      }));
  }, [renderedEdges]);

  // Deterministic layered layout by kind tier, then degree.

  const selectedNode = graph.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = graph.edges.find((e) => e.id === selectedEdgeId) ?? null;

  const onNodeClick = useCallback((_: unknown, node: Node<CodeGraphNodeData>) => {
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

  function resetView() {
    setExpandedIds(new Set());
    setSearch('');
    setUnresolvedOnly(false);
    setRelationFilter('all');
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
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
          <p>Explore the repository as a connected constellation. Search, filter, and click a relationship to see its evidence.</p>
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
          {visibleNodes.length}{nodesTruncated ? ` of ${candidateNodeCount}` : ''} nodes · {renderedEdges.length}{edgesTruncated ? ` of ${candidateEdges.length}` : ''} edges shown · click a node to expand
        </span>
      </div>

      <div style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', minHeight: 420 }}>
        <ReactFlow
          key={resetKey}
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={codeGraphNodeTypes}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          fitView
          minZoom={0.1}
          nodesConnectable={false}
          edgesFocusable={false}
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
  return (
    <div
      tabIndex={0}
      role="button"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 5,
        color: '#e2e8f0',
        minWidth: 112,
        maxWidth: 180,
        fontSize: 11,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: data.color }} />
      <div
        aria-label={data.label}
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          border: `2px solid ${data.color}`,
          background: `radial-gradient(circle at 35% 30%, ${data.color}55, rgba(6,9,13,0.96) 68%)`,
          boxShadow: `0 0 18px ${data.color}66`,
          display: 'grid',
          placeItems: 'center',
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        {(data.label.replace(/[^a-zA-Z0-9]/g, '')[0] ?? '?').toUpperCase()}
      </div>
      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{data.label}</div>
      <div style={{ opacity: 0.65, fontSize: 10 }}>{data.kind.replace('_', ' ')}{data.degree ? ` · ${data.degree}` : ''}</div>
      <Handle type="source" position={Position.Right} style={{ background: data.color }} />
    </div>
  );
});

const codeGraphNodeTypes = { codegraph: CodeGraphNode };
