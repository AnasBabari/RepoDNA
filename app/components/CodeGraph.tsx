'use client';

/**
 * Technical Code Graph explorer.
 *
 * Renders an expandable subgraph of the canonical v2 graph (or a v1.1 artifact
 * adapted without fabricated evidence). Starts from a focused, highest-degree
 * subgraph and expands neighborhoods on demand so large repositories never
 * render their entire graph at once.
 */

import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useMemo, useState } from 'react';

import { adaptV1ToV2Viewer } from '../lib/schema/artifact-loader';
import type { RepoDNAProject } from '../lib/types';
import type { RepoDNAProjectV2, GraphNode } from '../lib/analyzer/v2/types';

const INITIAL_NODE_LIMIT = 80;
const EXPAND_LIMIT = 24;

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

function normalizeProject(project: RepoDNAProject | RepoDNAProjectV2): RepoDNAProjectV2 {
  if ((project as RepoDNAProjectV2).schemaVersion === '2.0.0') return project as RepoDNAProjectV2;
  return adaptV1ToV2Viewer(project as RepoDNAProject);
}

function shortLabel(node: GraphNode): string {
  const q = node.qualifiedName || node.name || node.path;
  return q.length > 28 ? q.slice(0, 27) + '…' : q;
}

export function CodeGraph({ project }: { project: RepoDNAProject | RepoDNAProjectV2 }) {
  const graph = useMemo(() => normalizeProject(project), [project]);
  const [resetKey, setResetKey] = useState(0);

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

  const tierOrder = ['repository', 'workspace', 'package', 'directory', 'module', 'file', 'route', 'controller', 'class', 'interface', 'function', 'method', 'service', 'component', 'attribute', 'variable', 'data_model', 'table', 'dependency', 'configuration', 'external_system'];

  const rfNodes: Node<CodeGraphNodeData>[] = useMemo(() => {
    const byKind = new Map<string, number>();
    tierOrder.forEach((k, i) => byKind.set(k, i));
    const columns = new Map<number, number>();
    return visibleNodes.map((n) => {
      const tier = byKind.get(n.kind) ?? 99;
      const col = (columns.get(tier) ?? 0) + 1;
      columns.set(tier, col);
      return {
        id: n.id,
        position: { x: tier * 260, y: col * 90 },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleNodes, degreeById]);

  const rfEdges: Edge<CodeGraphEdgeData>[] = useMemo(() => {
    return filteredEdges
      .filter((e) => visibleNodeIds.has(e.source) && (!e.target || visibleNodeIds.has(e.target)))
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target ?? e.source,
        animated: e.status === 'unresolved' || e.status === 'ambiguous',
        style: {
          stroke: edgeTypeTone[e.type] ?? '#94a3b8',
          strokeDasharray: e.status === 'unresolved' ? '5 3' : undefined,
          opacity: 0.75,
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
  }, [filteredEdges, visibleNodeIds]);

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
  }

  const truncated = visibleNodes.length < graph.nodes.filter((n) => (granularity === 'structure' ? structureKinds : symbolKinds).has(n.kind)).length;

  return (
    <div className="code-graph-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 480 }}>
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
          {visibleNodes.length} nodes · {rfEdges.length} edges shown{truncated ? ` of ${graph.nodes.length}` : ''} · click a node to expand
        </span>
      </div>

      <div style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', minHeight: 420 }}>
        <ReactFlow
          key={resetKey}
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={{ codegraph: CodeGraphNode }}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          fitView
          minZoom={0.1}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
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

function CodeGraphNode({ data }: { data: CodeGraphNodeData }) {
  return (
    <div
      tabIndex={0}
      role="button"
      style={{
        background: 'rgba(6,9,13,0.95)',
        border: `1px solid ${data.color}`,
        borderRadius: 8,
        padding: '6px 10px',
        fontSize: 11,
        color: '#e2e8f0',
        minWidth: 140,
        maxWidth: 220,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: data.color }} />
      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.label}</div>
      <div style={{ opacity: 0.65, fontSize: 10 }}>{data.kind.replace('_', ' ')}{data.degree ? ` · ${data.degree}` : ''}</div>
      <Handle type="source" position={Position.Right} style={{ background: data.color }} />
    </div>
  );
}
