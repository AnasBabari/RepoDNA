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

type LayerFilter = 'all' | 'api' | 'services' | 'data' | 'infra';

export function ArchitectureGraph({
  components,
  connections,
  selectedId,
  onSelect,
}: {
  components: ArchitectureComponent[];
  connections: ArchitectureConnection[];
  selectedId: string | null;
  onSelect: (component: ArchitectureComponent) => void;
}) {
  const [filter, setFilter] = useState<LayerFilter>('all');

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

      return {
        id: component.id,
        type: 'architecture',
        position: layout.get(component.id) ?? { x: 0, y: 0 },
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
  }, [filteredComponents, connections, selectedId, components]);

  return (
    <div className="react-flow-shell" aria-label="Interactive architecture graph">
      {/* Top Layer Filtering Toolbar */}
      <div className="arch-toolbar">
        <div className="arch-filter-group">
          <button
            className={`arch-filter-btn ${filter === 'all' ? 'is-active' : ''}`}
            onClick={() => setFilter('all')}
            type="button"
          >
            All Layers ({components.length})
          </button>
          <button
            className={`arch-filter-btn ${filter === 'api' ? 'is-active' : ''}`}
            onClick={() => setFilter('api')}
            type="button"
          >
            Frontend & API
          </button>
          <button
            className={`arch-filter-btn ${filter === 'services' ? 'is-active' : ''}`}
            onClick={() => setFilter('services')}
            type="button"
          >
            Services & Core
          </button>
          <button
            className={`arch-filter-btn ${filter === 'data' ? 'is-active' : ''}`}
            onClick={() => setFilter('data')}
            type="button"
          >
            Data & Repos
          </button>
          <button
            className={`arch-filter-btn ${filter === 'infra' ? 'is-active' : ''}`}
            onClick={() => setFilter('infra')}
            type="button"
          >
            Infra & Config
          </button>
        </div>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelect(node.data)}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.25}
        maxZoom={1.8}
        nodesDraggable
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#192836" gap={32} size={1.2} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => tones[(node.data as ArchitectureNodeData).type]?.color ?? '#84919e'}
          maskColor="rgba(6, 9, 13, 0.85)"
        />
        <Controls showInteractive={false} />
      </ReactFlow>

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
