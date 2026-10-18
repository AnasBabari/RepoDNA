'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ResolutionGap } from '../lib/resolution-gaps';

const PAGE_SIZE = 25;
export function UnresolvedRelationshipList({ gaps, sourceId, onClearSource, onInspect, autoOpen = false }: {
  gaps: ResolutionGap[]; sourceId: string | null; onClearSource: () => void;
  onInspect: (edgeId: string) => void; autoOpen?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (sourceId) inputRef.current?.focus(); }, [sourceId]);
  const filtered = useMemo(() => gaps.filter((gap) => (!sourceId || gap.edge?.source === sourceId) &&
    [gap.id, gap.reason, gap.edge?.unresolvedExpression, gap.edge?.evidence.file, ...gap.candidates].join(' ').toLowerCase().includes(query.trim().toLowerCase())), [gaps, query, sourceId]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  return (
    <section className="panel unresolved-relationship-list" aria-label="Unresolved relationship records">
      <details open={autoOpen || sourceId ? true : undefined}>
        <summary>{gaps.length} retained unresolved / ambiguous records — inspect missing paths</summary>
        <p>These records are inspectable even when no line can be drawn. Canvas filters do not hide records from this list. Compaction may have omitted additional facts; check Graph scope.</p>
        <label>Search unresolved relationships<input ref={inputRef} className="search-input" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label>
        {sourceId && <p>Source: <code>{sourceId}</code> <button className="chip-button" type="button" onClick={onClearSource}>Show all sources</button></p>}
        <p role="status">{filtered.length} matching records · page {current + 1} of {pages}</p>
        <ul>{filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map((gap) => (
          <li key={gap.id}><details>
            <summary>{gap.edge?.unresolvedExpression || gap.id} · {gap.edge?.evidence.file || 'source unavailable'}</summary>
            <p>Reason: {gap.reason}</p>
            <p>Expression: <code>{gap.edge?.unresolvedExpression || 'not recorded'}</code></p>
            <p>Source: <code>{gap.edge?.source || 'not retained'}</code></p>
            <p>Evidence: {gap.edge ? `${gap.edge.evidence.file}:${gap.edge.evidence.range.startLine}:${gap.edge.evidence.range.startCol}–${gap.edge.evidence.range.endLine}:${gap.edge.evidence.range.endCol}` : 'not available in retained artifact'}</p>
            <p>Alternative candidates: {gap.candidates.length ? gap.candidates.join(', ') : 'none recorded'}</p>
            {gap.edge && <button className="chip-button" type="button" onClick={() => onInspect(gap.id)}>Inspect evidence</button>}
          </details></li>
        ))}</ul>
        {!filtered.length && <p>No matching retained records. This does not prove omitted code has no gaps.</p>}
        <div className="unresolved-pagination"><button className="chip-button" type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous records</button><button className="chip-button" type="button" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>Next records</button></div>
      </details>
    </section>
  );
}
