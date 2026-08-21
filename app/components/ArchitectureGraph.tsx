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
import { useMemo } from 'react';

import type { ArchitectureComponent, ArchitectureConnection } from '../lib/types';

type ArchitectureNodeData = ArchitectureComponent & { selected: boolean };
type ArchitectureNode = Node<ArchitectureNodeData, 'architecture'>;

const tones: Record<string, { color: string; rgb: string; label: string }> = {
  frontend: { color: '#4fe0f4', rgb: '79, 224, 244', label: 'Frontend' },
  api: { color: '#a78bfa', rgb: '167, 139, 250', label: 'API Layer' },
  services: { color: '#f59e0b', rgb: '245, 158, 11', label: 'Services' },
  domain: { color: '#f472b6', rgb: '244, 114, 182', label: 'Domain' },
  repositories: { color: '#60a5fa', rgb: '96, 165, 250', label: 'Repositories' },
  database: { color: '#34d399', rgb: '52, 211, 153', label: 'Database' },
  workers: { color: '#fb923c', rgb: '251, 146, 60', label: 'Workers' },
  infrastructure: { color: '#94a3b8', rgb: '148, 163, 184', label: 'Infrastructure' },
  configuration: { color: '#a1a1aa', rgb: '161, 161, 170', label: 'Config' },
  tests: { color: '#a3e635', rgb: '163, 230, 53', label: 'Tests' },
  other: { color: '#9ca3af', rgb: '156, 163, 175', label: 'Core' },
};

function ArchitectureNodeCard({ data }: NodeProps<ArchitectureNode>) {
  const tone = tones[data.type] ?? tones.other;
  const confidencePercent = Math.round(data.confidence * 100);

  return (
    <div
      className={`architecture-node ${data.selected ? 'is-selected' : ''}`}
      style={{
        '--node-accent': tone.color,
        '--node-accent-rgb': tone.rgb,
      } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Left} className="arch-handle" />
      <div className="arch-node-header">
        <span className="arch-node-badge">{tone.label}</span>
        <span className="arch-node-files">{data.files.length} file{data.files.length === 1 ? '' : 's'}</span>
      </div>
      <strong className="arch-node-title" title={data.name}>{data.name}</strong>
      <div className="arch-confidence-row">
        <div className="arch-confidence-bar">
          <div className="arch-confidence-fill" style={{ width: `${confidencePercent}%` }} />
        </div>
        <span className="arch-confidence-text">{confidencePercent}% match</span>
      </div>
      <Handle type="source" position={Position.Right} className="arch-handle" />
    </div>
  );
}

const nodeTypes = { architecture: ArchitectureNodeCard };

function positions(components: ArchitectureComponent[]) {
  const primaryOrder = ['frontend', 'api', 'services', 'domain', 'repositories', 'database'];
  const primarySet = new Set(primaryOrder);

  const primaryComponents = components
    .filter((c) => primarySet.has(c.type))
    .sort((a, b) => primaryOrder.indexOf(a.type) - primaryOrder.indexOf(b.type));

  const auxiliaryComponents = components
    .filter((c) => !primarySet.has(c.type));

  const map = new Map<string, { x: number; y: number }>();

  primaryComponents.forEach((comp, idx) => {
    map.set(comp.id, { x: 60 + idx * 260, y: 180 });
  });

  auxiliaryComponents.forEach((comp, idx) => {
    const isTop = idx % 2 === 0;
    const xPos = 180 + Math.floor(idx / 2) * 300;
    const yPos = isTop ? 20 : 350;
    map.set(comp.id, { x: xPos, y: yPos });
  });

  return map;
}

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
  const { nodes, edges } = useMemo(() => {
    const layout = positions(components);
    const graphNodes: ArchitectureNode[] = components.map((component) => ({
      id: component.id,
      type: 'architecture',
      position: layout.get(component.id) ?? { x: 0, y: 0 },
      data: { ...component, selected: component.id === selectedId },
    }));

    const graphEdges: Edge[] = connections.map((connection) => {
      const isMulti = connection.weight > 1;
      return {
        id: connection.id,
        source: connection.source,
        target: connection.target,
        type: 'smoothstep',
        animated: connection.type === 'calls' || connection.source === 'api' || connection.source === 'frontend',
        label: isMulti ? `${connection.weight} links` : undefined,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#4ce1f5',
          width: 14,
          height: 14,
        },
        style: {
          stroke: 'rgba(76, 225, 245, 0.45)',
          strokeWidth: Math.min(3, 1.5 + connection.weight * 0.4),
        },
        labelStyle: {
          fill: '#a0b1c0',
          fontSize: 9,
          fontFamily: 'var(--font-geist-mono)',
          fontWeight: 600,
        },
        labelBgStyle: {
          fill: '#080d12',
          fillOpacity: 0.92,
        },
        labelBgPadding: [6, 4],
        labelBgBorderRadius: 4,
      };
    });

    return { nodes: graphNodes, edges: graphEdges };
  }, [components, connections, selectedId]);

  return (
    <div className="react-flow-shell" aria-label="Interactive architecture graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelect(node.data)}
        fitView
        fitViewOptions={{ padding: 0.22 }}
        minZoom={0.3}
        maxZoom={1.8}
        nodesDraggable
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1c2b38" gap={28} size={1.2} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => tones[(node.data as ArchitectureNodeData).type]?.color ?? '#84919e'}
          maskColor="rgba(6, 9, 13, 0.82)"
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
