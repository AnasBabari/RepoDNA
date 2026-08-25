'use client';

import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo, useState } from 'react';

import type { ArchitectureComponent, ArchitectureConnection } from '../lib/types';

type NodeRelation = 'selected' | 'inbound' | 'outbound' | 'unrelated' | 'none';

type ArchitectureNodeData = ArchitectureComponent & {
  relation: NodeRelation;
};

type ArchitectureNode = Node<ArchitectureNodeData, 'architecture'>;

const tones: Record<string, { color: string; rgb: string; label: string; tier: number }> = {
  frontend: { color: '#4fe0f4', rgb: '79, 224, 244', label: 'Frontend', tier: 0 },
  api: { color: '#a78bfa', rgb: '167, 139, 250', label: 'API Layer', tier: 1 },
  services: { color: '#f59e0b', rgb: '245, 158, 11', label: 'Services', tier: 2 },
  domain: { color: '#f472b6', rgb: '244, 114, 182', label: 'Domain', tier: 2 },
  workers: { color: '#fb923c', rgb: '251, 146, 60', label: 'Workers', tier: 2 },
  repositories: { color: '#60a5fa', rgb: '96, 165, 250', label: 'Repositories', tier: 3 },
  database: { color: '#34d399', rgb: '52, 211, 153', label: 'Database', tier: 4 },
  infrastructure: { color: '#94a3b8', rgb: '148, 163, 184', label: 'Infrastructure', tier: 4 },
  configuration: { color: '#a1a1aa', rgb: '161, 161, 170', label: 'Config', tier: 4 },
  tests: { color: '#a3e635', rgb: '163, 230, 53', label: 'Tests', tier: 4 },
  other: { color: '#9ca3af', rgb: '156, 163, 175', label: 'Core', tier: 2 },
};

function ArchitectureNodeCard({ data }: NodeProps<ArchitectureNode>) {
  const tone = tones[data.type] ?? tones.other;
  const confidencePercent = Math.round(data.confidence * 100);

  const relationClass =
    data.relation === 'selected'
      ? 'is-selected'
      : data.relation === 'inbound'
      ? 'is-inbound'
      : data.relation === 'outbound'
      ? 'is-outbound'
      : data.relation === 'unrelated'
      ? 'is-dimmed'
      : '';

  return (
    <div
      className={`architecture-node ${relationClass}`}
      style={
        {
          '--node-accent': tone.color,
          '--node-accent-rgb': tone.rgb,
        } as React.CSSProperties
      }
    >
      <Handle type="target" position={Position.Top} id="top" className="arch-handle" />
      <Handle type="target" position={Position.Left} id="left" className="arch-handle" />

      <div className="arch-node-header">
        <span className="arch-node-badge">{tone.label}</span>
        <span className="arch-node-files">
          {data.files.length} file{data.files.length === 1 ? '' : 's'}
        </span>
      </div>

      <strong className="arch-node-title" title={data.name}>
        {data.name}
      </strong>

      <div className="arch-confidence-row">
        <div className="arch-confidence-bar">
          <div className="arch-confidence-fill" style={{ width: `${confidencePercent}%` }} />
        </div>
        <span className="arch-confidence-text">{confidencePercent}% match</span>
      </div>

      <Handle type="source" position={Position.Right} id="right" className="arch-handle" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="arch-handle" />
    </div>
  );
}

const nodeTypes = { architecture: ArchitectureNodeCard };
const ARCHITECTURE_NODE_WIDTH = 220;
const ARCHITECTURE_NODE_HEIGHT = 104;

/**
 * Calculates tiered hierarchical coordinates so graphs flow logically from
 * Frontend -> API -> Services -> Repositories -> Database/Infra
 */
function computeTieredPositions(components: ArchitectureComponent[]) {
  const tiers: ArchitectureComponent[][] = [[], [], [], [], []];

  components.forEach((comp) => {
    const tierIdx = tones[comp.type]?.tier ?? 2;
    tiers[tierIdx].push(comp);
  });

  const map = new Map<string, { x: number; y: number }>();
  const NODE_WIDTH = 230;
  const GAP_X = 70;
  const GAP_Y = 170;
  const START_Y = 50;

  // Find max row width to center all tiers
  let maxCount = 1;
  tiers.forEach((tier) => {
    if (tier.length > maxCount) maxCount = tier.length;
  });
  const maxRowWidth = maxCount * NODE_WIDTH + (maxCount - 1) * GAP_X;

  let currentY = START_Y;

  tiers.forEach((tierComponents) => {
    if (tierComponents.length === 0) return;

    const rowWidth =
      tierComponents.length * NODE_WIDTH + (tierComponents.length - 1) * GAP_X;
    const startX = Math.max(60, (maxRowWidth - rowWidth) / 2 + 60);

    tierComponents.forEach((comp, idx) => {
      const x = startX + idx * (NODE_WIDTH + GAP_X);
      map.set(comp.id, { x, y: currentY });
    });

    currentY += GAP_Y;
  });

  return map;
}

export type LayerFilter = 'all' | 'api' | 'services' | 'data' | 'infra';

export interface SavedArchitectureView {
  version: 1;
  graphFingerprint: string;
  positions: Record<string, { x: number; y: number }>;
  viewport?: { x: number; y: number; zoom: number };
  filter?: LayerFilter;
}

function hashString(str: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

function computeGraphFingerprint(
  components: ArchitectureComponent[],
  connections: ArchitectureConnection[]
): string {
  const compStr = components
    .map((c) => `${c.id}:${c.type}:${c.files.length}`)
    .sort()
    .join('|');
  const connStr = connections
    .map((c) => `${c.source}->${c.target}:${c.type}`)
    .sort()
    .join('|');
  return hashString(`${compStr}#${connStr}`);
}

function computeStorageKey(repoId: string, graphFingerprint: string): string {
  const combined = `${repoId || 'anonymous'}:${graphFingerprint}`;
  return `repodna_view_v1_${hashString(combined)}`;
}

function loadSavedView(
  repoId: string | undefined,
  graphFingerprint: string,
  validComponentIds: Set<string>
): SavedArchitectureView | null {
  if (typeof window === 'undefined' || !repoId) return null;
  const storageKey = computeStorageKey(repoId, graphFingerprint);
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;

    const obj = parsed as Record<string, unknown>;
    if (obj.version !== 1 || obj.graphFingerprint !== graphFingerprint) return null;
    if (!obj.positions || typeof obj.positions !== 'object') return null;

    const rawPositions = obj.positions as Record<string, unknown>;
    const keys = Object.keys(rawPositions);
    if (keys.length > 500) return null;

    const positions: Record<string, { x: number; y: number }> = {};
    for (const key of keys) {
      if (!validComponentIds.has(key)) continue;
      const pt = rawPositions[key];
      if (pt && typeof pt === 'object') {
        const x = (pt as { x?: unknown }).x;
        const y = (pt as { y?: unknown }).y;
        if (
          typeof x === 'number' && Number.isFinite(x) && x >= -50000 && x <= 50000 &&
          typeof y === 'number' && Number.isFinite(y) && y >= -50000 && y <= 50000
        ) {
          positions[key] = { x: Math.round(x), y: Math.round(y) };
        }
      }
    }

    let viewport: { x: number; y: number; zoom: number } | undefined;
    if (obj.viewport && typeof obj.viewport === 'object') {
      const v = obj.viewport as { x?: unknown; y?: unknown; zoom?: unknown };
      if (
        typeof v.x === 'number' && Number.isFinite(v.x) &&
        typeof v.y === 'number' && Number.isFinite(v.y) &&
        typeof v.zoom === 'number' && Number.isFinite(v.zoom) && v.zoom >= 0.1 && v.zoom <= 4
      ) {
        viewport = { x: v.x, y: v.y, zoom: v.zoom };
      }
    }

    let filter: LayerFilter | undefined;
    const validFilters = new Set(['all', 'api', 'services', 'data', 'infra']);
    if (typeof obj.filter === 'string' && validFilters.has(obj.filter)) {
      filter = obj.filter as LayerFilter;
    }

    return {
      version: 1,
      graphFingerprint,
      positions,
      viewport,
      filter,
    };
  } catch {
    return null;
  }
}

export function ArchitectureGraph({
  components,
  connections,
  selectedId,
  onSelect,
  repositoryId,
}: {
  components: ArchitectureComponent[];
  connections: ArchitectureConnection[];
  selectedId: string | null;
  onSelect: (component: ArchitectureComponent) => void;
  repositoryId?: string;
}) {
  const componentIds = useMemo(() => new Set(components.map((c) => c.id)), [components]);
  const graphFingerprint = useMemo(
    () => computeGraphFingerprint(components, connections),
    [components, connections]
  );

  const initialSavedView = useMemo(
    () => loadSavedView(repositoryId, graphFingerprint, componentIds),
    [repositoryId, graphFingerprint, componentIds]
  );

  const [filter, setFilter] = useState<LayerFilter>(() => initialSavedView?.filter ?? 'all');
  const [customPositions, setCustomPositions] = useState<Record<string, { x: number; y: number }>>(
    () => initialSavedView?.positions ?? {}
  );
  const [viewport, setViewport] = useState<{ x: number; y: number; zoom: number } | undefined>(
    () => initialSavedView?.viewport
  );

  const hasCustomView = useMemo(() => {
    return Object.keys(customPositions).length > 0 || filter !== 'all' || viewport !== undefined;
  }, [customPositions, filter, viewport]);

  const persistCurrentView = (
    nextPositions: Record<string, { x: number; y: number }>,
    nextFilter: LayerFilter,
    nextViewport?: { x: number; y: number; zoom: number }
  ) => {
    if (typeof window === 'undefined' || !repositoryId) return;
    const storageKey = computeStorageKey(repositoryId, graphFingerprint);
    try {
      const payload: SavedArchitectureView = {
        version: 1,
        graphFingerprint,
        positions: nextPositions,
        filter: nextFilter,
        viewport: nextViewport,
      };
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {}
  };

  const handleResetView = () => {
    setCustomPositions({});
    setFilter('all');
    setViewport(undefined);
    if (typeof window !== 'undefined' && repositoryId) {
      try {
        const storageKey = computeStorageKey(repositoryId, graphFingerprint);
        localStorage.removeItem(storageKey);
      } catch {}
    }
  };

  const handleNodeDragStop: OnNodeDrag<ArchitectureNode> = (_, node) => {
    setCustomPositions((prev) => {
      const next = {
        ...prev,
        [node.id]: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
      };
      persistCurrentView(next, filter, viewport);
      return next;
    });
  };

  const handleFilterChange = (nextFilter: LayerFilter) => {
    setFilter(nextFilter);
    persistCurrentView(customPositions, nextFilter, viewport);
  };

  const handleMoveEnd = (_: unknown, nextViewport: { x: number; y: number; zoom: number }) => {
    setViewport(nextViewport);
    persistCurrentView(customPositions, filter, nextViewport);
  };

  const filteredComponents = useMemo(() => {
    if (filter === 'all') return components;
    if (filter === 'api') return components.filter((c) => c.type === 'frontend' || c.type === 'api');
    if (filter === 'services') return components.filter((c) => c.type === 'services' || c.type === 'domain' || c.type === 'workers' || c.type === 'other');
    if (filter === 'data') return components.filter((c) => c.type === 'repositories' || c.type === 'database');
    if (filter === 'infra') return components.filter((c) => c.type === 'infrastructure' || c.type === 'configuration' || c.type === 'tests');
    return components;
  }, [components, filter]);

  const { nodes, edges } = useMemo(() => {
    const layout = computeTieredPositions(filteredComponents);
    const componentIds = new Set(filteredComponents.map((c) => c.id));

    // Active subgraph highlighting
    const inboundSources = new Set<string>();
    const outboundTargets = new Set<string>();

    if (selectedId) {
      connections.forEach((conn) => {
        if (conn.target === selectedId) inboundSources.add(conn.source);
        if (conn.source === selectedId) outboundTargets.add(conn.target);
      });
    }

    const graphNodes: ArchitectureNode[] = filteredComponents.map((component) => {
      let relation: NodeRelation = 'none';
      if (selectedId) {
        if (component.id === selectedId) relation = 'selected';
        else if (inboundSources.has(component.id)) relation = 'inbound';
        else if (outboundTargets.has(component.id)) relation = 'outbound';
        else relation = 'unrelated';
      }

      const defaultPos = layout.get(component.id) ?? { x: 0, y: 0 };
      const pos = customPositions[component.id] ?? defaultPos;

      return {
        id: component.id,
        type: 'architecture',
        position: pos,
        initialWidth: ARCHITECTURE_NODE_WIDTH,
        initialHeight: ARCHITECTURE_NODE_HEIGHT,
        data: {
          ...component,
          relation,
        },
      };
    });

    const relevantConnections = connections.filter(
      (conn) => componentIds.has(conn.source) && componentIds.has(conn.target)
    );

    const graphEdges: Edge[] = relevantConnections.map((connection) => {
      const isSelectedOutbound = selectedId && connection.source === selectedId;
      const isSelectedInbound = selectedId && connection.target === selectedId;
      const isUnrelated = selectedId && !isSelectedOutbound && !isSelectedInbound;

      const sourceTier = tones[components.find((c) => c.id === connection.source)?.type ?? '']?.tier ?? 2;
      const targetTier = tones[components.find((c) => c.id === connection.target)?.type ?? '']?.tier ?? 2;

      let sourceHandle = 'bottom';
      let targetHandle = 'top';

      if (sourceTier === targetTier) {
        sourceHandle = 'right';
        targetHandle = 'left';
      } else if (sourceTier > targetTier) {
        sourceHandle = 'top';
        targetHandle = 'bottom';
      }

      let strokeColor = 'rgba(76, 225, 245, 0.45)';
      let strokeWidth = Math.min(3.5, 1.5 + connection.weight * 0.4);

      if (isSelectedOutbound) {
        strokeColor = '#4fe0f4';
        strokeWidth = 3;
      } else if (isSelectedInbound) {
        strokeColor = '#34d399';
        strokeWidth = 3;
      } else if (isUnrelated) {
        strokeColor = 'rgba(76, 225, 245, 0.08)';
      }

      return {
        id: connection.id,
        source: connection.source,
        target: connection.target,
        sourceHandle,
        targetHandle,
        type: 'bezier',
        animated: isSelectedOutbound || isSelectedInbound || connection.source === 'api',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isSelectedInbound ? '#34d399' : '#4ce1f5',
          width: 14,
          height: 14,
        },
        style: {
          stroke: strokeColor,
          strokeWidth,
          opacity: isUnrelated ? 0.15 : 1,
        },
      };
    });

    return { nodes: graphNodes, edges: graphEdges };
  }, [filteredComponents, connections, selectedId, components, customPositions]);

  return (
    <div className="react-flow-shell" aria-label="Interactive architecture graph">
      {/* Top Layer Filtering Toolbar & Custom Layout Actions */}
      <div className="arch-toolbar">
        <div className="arch-filter-group">
          <button
            className={`arch-filter-btn ${filter === 'all' ? 'is-active' : ''}`}
            onClick={() => handleFilterChange('all')}
            type="button"
          >
            All Layers ({components.length})
          </button>
          <button
            className={`arch-filter-btn ${filter === 'api' ? 'is-active' : ''}`}
            onClick={() => handleFilterChange('api')}
            type="button"
          >
            Frontend & API
          </button>
          <button
            className={`arch-filter-btn ${filter === 'services' ? 'is-active' : ''}`}
            onClick={() => handleFilterChange('services')}
            type="button"
          >
            Services & Core
          </button>
          <button
            className={`arch-filter-btn ${filter === 'data' ? 'is-active' : ''}`}
            onClick={() => handleFilterChange('data')}
            type="button"
          >
            Data & Repos
          </button>
          <button
            className={`arch-filter-btn ${filter === 'infra' ? 'is-active' : ''}`}
            onClick={() => handleFilterChange('infra')}
            type="button"
          >
            Infra & Config
          </button>
        </div>

        {hasCustomView && (
          <div className="arch-toolbar-actions">
            <button
              className="arch-reset-btn"
              onClick={handleResetView}
              type="button"
              title="Reset to default auto-calculated layout and view"
            >
              ↺ Reset View
            </button>
          </div>
        )}
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelect(node.data)}
        onNodeDragStop={handleNodeDragStop}
        onMoveEnd={handleMoveEnd}
        defaultViewport={viewport}
        fitView={!viewport}
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.25}
        maxZoom={1.8}
        nodesDraggable
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#192836" gap={32} size={1.2} />
        <MiniMap<ArchitectureNode>
          pannable
          zoomable
          ariaLabel="Architecture map navigator. Drag to pan, scroll to zoom, or select a node."
          bgColor="#081018"
          nodeColor={(node) => tones[(node.data as ArchitectureNodeData).type]?.color ?? '#84919e'}
          nodeStrokeColor="#dffbff"
          nodeStrokeWidth={3}
          nodeBorderRadius={6}
          maskColor="rgba(2, 8, 12, 0.42)"
          maskStrokeColor="#4ce1f5"
          maskStrokeWidth={2}
          onNodeClick={(_, node) => onSelect(node.data)}
        />
        <Controls showInteractive={false} />
      </ReactFlow>

      <div className="minimap-help" aria-hidden="true">
        Navigator · drag to pan · scroll to zoom
      </div>

      {/* Bottom Architectural Legend Bar */}
      <div className="arch-legend-bar">
        <div className="arch-legend-item">
          <span className="arch-legend-dot" style={{ background: '#4fe0f4' }} /> Frontend
        </div>
        <div className="arch-legend-item">
          <span className="arch-legend-dot" style={{ background: '#a78bfa' }} /> API
        </div>
        <div className="arch-legend-item">
          <span className="arch-legend-dot" style={{ background: '#f59e0b' }} /> Services
        </div>
        <div className="arch-legend-item">
          <span className="arch-legend-dot" style={{ background: '#60a5fa' }} /> Repositories
        </div>
        <div className="arch-legend-item">
          <span className="arch-legend-dot" style={{ background: '#34d399' }} /> Database
        </div>
      </div>
    </div>
  );
}
