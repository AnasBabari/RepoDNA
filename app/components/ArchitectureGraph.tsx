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

const order = ['frontend', 'api', 'services', 'domain', 'repositories', 'database', 'workers', 'infrastructure', 'configuration', 'tests', 'other'];
const tones: Record<string, string> = {
  frontend: '#4fe0f4', api: '#a78bfa', services: '#f4bd55', domain: '#f889bb',
  repositories: '#74c7ff', database: '#56d8a4', workers: '#ff8f70',
  infrastructure: '#9ba8b4', configuration: '#8d99a5', tests: '#bbdf7a', other: '#84919e',
};

function ArchitectureNodeCard({ data }: NodeProps<ArchitectureNode>) {
  const accent = tones[data.type] ?? tones.other;
  return (
    <button
      className={`architecture-node ${data.selected ? 'is-selected' : ''}`}
      style={{ '--node-accent': accent } as React.CSSProperties}
      type="button"
    >
      <Handle type="target" position={Position.Left} />
      <span className="architecture-node-type">{data.type}</span>
      <strong>{data.name}</strong>
      <span>{data.files.length} file{data.files.length === 1 ? '' : 's'}</span>
      <i>{Math.round(data.confidence * 100)}% confidence</i>
      <Handle type="source" position={Position.Right} />
    </button>
  );
}

const nodeTypes = { architecture: ArchitectureNodeCard };

function positions(components: ArchitectureComponent[]) {
  const sorted = [...components].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  const primary = new Set(['frontend', 'api', 'services', 'domain', 'repositories', 'database']);
  let primaryIndex = 0;
  let secondaryIndex = 0;
  return new Map(sorted.map((component) => {
    if (primary.has(component.type)) {
      const index = primaryIndex++;
      return [component.id, { x: 70 + index * 235, y: 160 }];
    }
    const index = secondaryIndex++;
    return [component.id, { x: 220 + index * 250, y: index % 2 === 0 ? 20 : 325 }];
  }));
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
    const graphEdges: Edge[] = connections.map((connection) => ({
      id: connection.id,
      source: connection.source,
      target: connection.target,
      label: connection.weight > 1 ? String(connection.weight) : undefined,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#51616f' },
      style: { stroke: '#51616f', strokeWidth: Math.min(3, 1 + connection.weight / 4) },
      labelStyle: { fill: '#84919c', fontSize: 9 },
      labelBgStyle: { fill: '#0b1015' },
    }));
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
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.35}
        maxZoom={1.8}
        nodesDraggable
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#26313a" gap={28} size={1} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => tones[(node.data as ArchitectureNodeData).type] ?? tones.other}
          maskColor="rgba(7,10,14,.72)"
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

