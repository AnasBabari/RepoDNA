import { X } from './icons';
import type { GraphEdge } from '../lib/analyzer/v2/types';

export function CodeGraphEvidenceDrawer({
  edge,
  onClose,
}: {
  edge: GraphEdge;
  onClose: () => void;
}) {
  return (
    <aside className="graph-evidence-drawer" aria-label="Why are these connected">
      <h4 className="graph-evidence-title">Why are these connected?</h4>
      <p className="graph-detail-copy">
        <strong>{edge.type}</strong> ({edge.status}, confidence {Math.round(edge.confidence * 100)}%)
      </p>
      <p className="graph-detail-copy">{edge.explanation}</p>
      <p className="graph-detail-meta">
        Evidence: {edge.evidence.file}:{edge.evidence.range.startLine}:{edge.evidence.range.startCol}-{edge.evidence.range.endLine}:{edge.evidence.range.endCol}
        {' '}· resolver {edge.resolver.name}@{edge.resolver.version}
      </p>
      {edge.unresolvedExpression ? (
        <p className="graph-detail-unresolved">Unresolved expression: {edge.unresolvedExpression}</p>
      ) : null}
      {(edge.alternativeCandidates?.length ?? 0) > 0 ? (
        <p className="graph-detail-alternatives">Alternative candidates: {edge.alternativeCandidates!.join(', ')}</p>
      ) : null}
      <button className="chip-button graph-detail-close" onClick={onClose} type="button">
        <X size={14} aria-hidden="true" /> Close
      </button>
    </aside>
  );
}
