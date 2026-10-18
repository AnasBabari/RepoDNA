import type { GraphNode } from '../lib/analyzer/v2/types';

export function CodeGraphNodeDetail({
  node,
  degree,
  unresolvedCount = 0,
  onShowUnresolved,
  onClose,
}: {
  node: GraphNode;
  degree: number;
  unresolvedCount?: number;
  onShowUnresolved?: () => void;
  onClose?: () => void;
}) {
  return (
    <aside className="graph-node-detail" aria-label="Node details" tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose?.(); } }}>
      {onClose && <button className="chip-button" type="button" onClick={onClose}>Close node details</button>}
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
