import { useMemo } from 'react';
import type { ManifestInventory } from '../lib/analyzer/manifest-types';
import { manifestCounts, unavailableManifests } from '../lib/analyzer/manifest-types';
import type { SourceOutcomes, SourcePathCounts } from '../lib/analyzer/source-inventory';

const unavailable = unavailableManifests();
const DISPLAY_LIMIT = 20;
export function ManifestInventoryPanel({ manifests = unavailable, sources, outcomes }: {
  manifests?: ManifestInventory;
  sources?: SourcePathCounts;
  outcomes?: SourceOutcomes;
}) {
  const counts = useMemo(() => manifestCounts(manifests), [manifests]);
  return (
    <section className="panel coverage-panel" aria-label="Inventory evidence">
      <div className="panel-heading">
        <div><p className="eyebrow">Manifest evidence</p><h2>Packages & declared dependencies</h2></div>
        <span>{manifests.status === 'partial' ? 'Partial · lower bounds' : manifests.status === 'unavailable' ? 'Not recorded' : 'Recorded'}</span>
      </div>
      <div className="coverage-grid">
        <div><span>Package roots</span><strong>{counts.packages ?? 'Not recorded'}</strong></div>
        <div><span>Declared dependencies</span><strong>{counts.dependencies ?? 'Not recorded'}</strong></div>
        <div><span>Runtime</span><strong>{counts.scopes.runtime ?? 'Not recorded'}</strong></div>
        <div><span>Development</span><strong>{counts.scopes.development ?? 'Not recorded'}</strong></div>
      </div>
      <p className="coverage-note">These are manifest declarations, not import counts. A dependency is counted once per ecosystem and owning package root. Scope totals can overlap.</p>
      {manifests.status === 'unavailable' ? <p>Run a fresh analysis to record manifest evidence; older snapshots cannot establish these counts.</p> : (
        <details className="coverage-skipped-details">
          <summary>Inspect declaration evidence</summary>
          <p>Optional: {counts.scopes.optional} · Peer: {counts.scopes.peer} · Build: {counts.scopes.build} · Unspecified: {counts.scopes.unspecified}</p>
          <ul>{manifests.packages.slice(0, DISPLAY_LIMIT).map((item) => <li key={`${item.ecosystem}:${item.root}`}><code>{item.root}</code><span>{item.ecosystem} · {item.name ?? 'Unnamed package'}{item.workspace ? ' · workspace root' : ''} · {item.manifests.join(', ')}</span></li>)}</ul>
          <ul>{manifests.declarations.slice(0, DISPLAY_LIMIT).map((item) => <li key={JSON.stringify(item)}><code>{item.name}</code><span>{item.scope} · {item.group} · {item.file} · owner: {item.root}</span></li>)}</ul>
          <p>Showing up to {DISPLAY_LIMIT} package roots and {DISPLAY_LIMIT} declaration records; graph exports contain all retained evidence.</p>
          {manifests.problems.length > 0 ? <ul>{manifests.problems.slice(0, DISPLAY_LIMIT).map((item, index) => <li key={`${item.file}:${item.code}:${index}`}><code>{item.file}</code><span>{item.code}: {item.message}</span></li>)}</ul> : null}
        </details>
      )}
      {outcomes ? <p className="coverage-note">Supported source: {outcomes.complete} complete + {outcomes.partial} partial + {outcomes.failed} failed + {outcomes.skipped} skipped + {outcomes.unprocessed} unprocessed = {outcomes.supported}. Parsed includes complete and partial; do not add partial twice.</p> : <p className="coverage-note">Legacy source accounting: run a fresh scan for the current supported-source denominator.</p>}
      {sources ? <p className="coverage-note">Observed paths: {sources.totalFileCount}; supported source: {sources.supportedSourceFileCount}; unsupported source: {sources.unsupportedSourceFileCount}; evidence files: {sources.evidenceFileCount}; other: {sources.otherFileCount}; ignored: {sources.ignoredFileCount}; generated: {sources.generatedFileCount}. Acquisition limits still apply.</p> : null}
    </section>
  );
}
