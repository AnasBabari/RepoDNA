import type { GraphNode } from '../lib/analyzer/v2/types';

export function CodeGraphNodeDetail({
  node,
  degree,
  unresolvedCount = 0,
  onShowUnresolved,
}: {
  node: GraphNode;
  degree: number;
  unresolvedCount?: number;
  onShowUnresolved?: () => void;
}) {
  return (
    <aside className="graph-node-detail" aria-label="Node details">
      <h4 className="graph-node-detail-title">{node.qualifiedName}</h4>
      <p className="graph-detail-meta">
        {node.kind} · {node.language || 'n/a'} · {node.path || '—'}:{node.range.startLine}
        {degree ? ` · ${degree} connections` : ''}
      </p>
      {unresolvedCount > 0 && onShowUnresolved ? <button className="chip-button" type="button" onClick={onShowUnresolved}>Show {unresolvedCount} unresolved relationships</button> : null}
      {(node.evidence?.length ?? 0) > 0 ? (
        <p className="graph-detail-alternatives">Evidence: {node.evidence!.join(' · ')}</p>
      ) : null}
    </aside>
  );
}
