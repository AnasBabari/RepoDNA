import type { GraphNode } from '../lib/analyzer/v2/types';

export function CodeGraphNodeDetail({
  node,
  degree,
}: {
  node: GraphNode;
  degree: number;
}) {
  return (
    <aside className="graph-node-detail" aria-label="Node details">
      <h4 className="graph-node-detail-title">{node.qualifiedName}</h4>
      <p className="graph-detail-meta">
        {node.kind} · {node.language || 'n/a'} · {node.path || '—'}:{node.range.startLine}
        {degree ? ` · ${degree} connections` : ''}
      </p>
      {(node.evidence?.length ?? 0) > 0 ? (
        <p className="graph-detail-alternatives">Evidence: {node.evidence!.join(' · ')}</p>
      ) : null}
    </aside>
  );
}
