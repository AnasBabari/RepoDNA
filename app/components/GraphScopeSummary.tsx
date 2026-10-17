import type { GraphScope } from '../lib/analyzer/v2/types';
import { formatGraphCount, GRAPH_COUNT_KEYS } from '../lib/graph-scope';

const LABELS = {
  nodes: 'Nodes', relationships: 'Relationships',
  unresolvedRelationships: 'Unresolved / ambiguous relationships', ambiguousRelationships: 'Ambiguous relationships',
};

export function GraphScopeSummary({ scope }: { scope: GraphScope }) {
  return (
    <section className="graph-scope-summary" aria-label="Graph scope">
      <strong>{scope.kind === 'compacted' ? 'Bounded graph — some extracted findings were omitted' : 'All retained findings — graph was not compacted'}</strong>
      <p>Whole-analysis resolution gaps: {formatGraphCount(scope.original.unresolvedRelationships)}; retained gaps: {formatGraphCount(scope.retained.unresolvedRelationships)}. Unknown totals are not zero.</p>
      <p>Analytics scope: {scope.analyticsScope === 'retained-subgraph' ? 'retained subgraph only; cycles, communities and centrality do not cover omitted facts.' : 'uncompacted extracted graph; static extraction does not prove runtime completeness.'}</p>
      <details>
        <summary>Original, retained and omitted counts</summary>
        <div className="graph-scope-table-wrap"><table>
          <thead><tr><th>Extracted facts</th><th>Original</th><th>Retained</th><th>Omitted</th></tr></thead>
          <tbody>{GRAPH_COUNT_KEYS.map((key) => <tr key={key}><th scope="row">{LABELS[key]}</th><td>{formatGraphCount(scope.original[key])}</td><td>{formatGraphCount(scope.retained[key])}</td><td>{formatGraphCount(scope.omitted[key])}</td></tr>)}</tbody>
        </table></div>
      </details>
    </section>
  );
}
