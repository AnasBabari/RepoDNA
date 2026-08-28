'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { trackGraphExported } from '../lib/analytics';
import {
  createBrowserExportId,
  getBrowserExport,
  saveBrowserExport,
  type BrowserCacheSourceType,
} from '../lib/export/browser-export-cache';
import { buildGraphExportViaWorker } from '../lib/export/graph/worker-client';
import type { AnyExportableArtifact } from '../lib/export/graph/normalize';
import type { GraphExportFormat } from '../lib/export/graph/types';
import { generateTextReport } from '../lib/export/text-report';

type ExportStatus = 'idle' | 'loading' | 'success' | 'error';
type CacheLayer = 'vercel_blob' | 'indexeddb' | 'browser_worker';

interface FormatState {
  status: ExportStatus;
  progress: number;
  stage: string;
  error: string | null;
  cacheHit: boolean | null;
  cacheLayer: CacheLayer | null;
  sha256: string | null;
  byteSize: number | null;
  expiresAt: string | null;
}

const FORMAT_LABELS: Record<GraphExportFormat, { label: string; description: string }> = {
  'graph-json': { label: 'Graph JSON', description: 'Single JSON file — complete graph with manifest' },
  csv: { label: 'CSV tables', description: 'ZIP containing five CSV tables plus manifest.json' },
  cypher: { label: 'Neo4j Cypher', description: 'cypher.txt for Neo4j 5+ — deterministic MERGE, no APOC or AI key' },
  parquet: { label: 'Parquet', description: 'ZIP containing Arrow/DuckDB-ready Parquet tables' },
};

const ALL_FORMATS: GraphExportFormat[] = ['graph-json', 'csv', 'cypher', 'parquet'];

function emptyState(): FormatState {
  return {
    status: 'idle',
    progress: 0,
    stage: '',
    error: null,
    cacheHit: null,
    cacheLayer: null,
    sha256: null,
    byteSize: null,
    expiresAt: null,
  };
}

function initialStates(): Record<GraphExportFormat, FormatState> {
  return Object.fromEntries(ALL_FORMATS.map((format) => [format, emptyState()])) as Record<
    GraphExportFormat,
    FormatState
  >;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

function downloadFromUrl(url: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function analyticsFormat(format: GraphExportFormat): 'graph_json' | 'graph_csv' | 'cypher' | 'parquet' {
  if (format === 'graph-json') return 'graph_json';
  if (format === 'csv') return 'graph_csv';
  return format;
}

function friendlyError(error: unknown): string {
  const code = (error as { code?: string }).code;
  if (code === 'PARQUET_EXPORT_DISABLED') return 'Parquet export is not enabled yet.';
  if (code === 'EXPORT_GRAPH_INVALID') return 'The loaded graph failed export validation.';
  if ((error as Error)?.name === 'AbortError') return '';
  return 'Export failed. Please retry.';
}

export interface GraphExportDialogProps {
  onClose: () => void;
  artifact: AnyExportableArtifact | null;
  manifest: {
    counts: { nodes: number; relationships: number; groups: number; unresolved: number };
    coverage: { percentage: number };
    completeness: { status: string };
    adaptedFromLegacy: boolean;
  } | null;
  origin: BrowserCacheSourceType;
  publicIdentity: { owner: string; repo: string; commitSha: string } | null;
  browserRetention: {
    enabled: boolean;
    artifactKey: string | null;
    expiresAt: number | null;
  };
}

export function GraphExportDialog({
  onClose,
  artifact,
  manifest,
  origin,
  publicIdentity,
  browserRetention,
}: GraphExportDialogProps) {
  const [states, setStates] = useState<Record<GraphExportFormat, FormatState>>(initialStates);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [cacheWarning, setCacheWarning] = useState<string | null>(null);
  const abortControllers = useRef<Partial<Record<GraphExportFormat, AbortController>>>({});
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const visibleFormats = useMemo(
    () => ALL_FORMATS.filter((format) => format !== 'parquet' || process.env.NEXT_PUBLIC_REPODNA_PARQUET_EXPORT === 'true'),
    []
  );

  const closeDialog = useCallback(() => {
    for (const controller of Object.values(abortControllers.current)) controller?.abort();
    abortControllers.current = {};
    onClose();
  }, [onClose]);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () => Array.from(dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
    const closeButton = dialog?.querySelector<HTMLElement>('.graph-export-close');
    const initialFocus = dialog?.querySelector<HTMLElement>('.graph-export-close') ?? focusables()[0];
    initialFocus?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const activeIndex = active ? items.indexOf(active) : -1;
      if (activeIndex === -1) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (active === closeButton || activeIndex === 0)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeIndex === items.length - 1) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocusedRef.current?.isConnected) previouslyFocusedRef.current.focus();
    };
  }, [closeDialog]);

  const updateState = useCallback((format: GraphExportFormat, patch: Partial<FormatState>) => {
    setStates((previous) => ({ ...previous, [format]: { ...previous[format], ...patch } }));
  }, []);

  const recordAnalytics = useCallback(
    (
      format: GraphExportFormat,
      cacheLayer: CacheLayer,
      cacheHit: boolean,
      success: boolean,
      startedAt: number,
      byteSize: number
    ) => {
      trackGraphExported({
        format: analyticsFormat(format),
        sourceCategory: origin,
        cacheLayer,
        cacheHit,
        success,
        durationMs: Date.now() - startedAt,
        byteSize,
      });
    },
    [origin]
  );

  const handleExport = useCallback(
    async (format: GraphExportFormat) => {
      if (!artifact || !manifest) return;
      const controller = new AbortController();
      abortControllers.current[format]?.abort();
      abortControllers.current[format] = controller;
      updateState(format, { ...emptyState(), status: 'loading', stage: 'normalizing' });
      setFallbackNotice(null);
      setCacheWarning(null);
      const startedAt = Date.now();
      let cacheLayer: CacheLayer = 'browser_worker';

      try {
        if (browserRetention.enabled && browserRetention.artifactKey) {
          const cached = await getBrowserExport(createBrowserExportId(browserRetention.artifactKey, format));
          if (controller.signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
          if (cached) {
            cacheLayer = 'indexeddb';
            downloadBlob(cached.blob, cached.filename);
            updateState(format, {
              status: 'success',
              progress: 100,
              stage: 'complete',
              cacheHit: true,
              cacheLayer,
              sha256: cached.sha256,
              byteSize: cached.byteSize,
              expiresAt: new Date(cached.expiresAt).toISOString(),
            });
            recordAnalytics(format, cacheLayer, true, true, startedAt, cached.byteSize);
            return;
          }
        }

        if (origin === 'public-durable' && publicIdentity) {
          const response = await fetch('/api/v2/exports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              owner: publicIdentity.owner,
              repo: publicIdentity.repo,
              commitSha: publicIdentity.commitSha,
              format,
              exportSchemaVersion: '1.0.0',
            }),
            signal: controller.signal,
          });
          if (response.ok) {
            const data = (await response.json()) as {
              filename: string;
              mediaType: string;
              byteSize: number;
              sha256: string;
              cache: { hit: boolean; expiresAt: string };
              download: { url: string; expiresAt: string };
            };
            cacheLayer = 'vercel_blob';
            downloadFromUrl(data.download.url, data.filename);
            updateState(format, {
              status: 'success',
              progress: 100,
              stage: 'complete',
              cacheHit: data.cache.hit,
              cacheLayer,
              sha256: data.sha256,
              byteSize: data.byteSize,
              expiresAt: data.cache.expiresAt,
            });
            recordAnalytics(format, cacheLayer, data.cache.hit, true, startedAt, data.byteSize);
            return;
          }

          const body = (await response.json().catch(() => null)) as {
            error?: { code?: string; fallbackAvailable?: boolean };
          } | null;
          const fallbackCodes = new Set([
            'ANALYSIS_ARTIFACT_NOT_FOUND',
            'ANALYSIS_ARTIFACT_EXPIRED',
            'EXPORT_CACHE_UNAVAILABLE',
            'EXPORT_DOWNLOAD_UNAVAILABLE',
            'RATE_LIMIT_UNAVAILABLE',
          ]);
          const code = body?.error?.code;
          if (!body?.error?.fallbackAvailable && (!code || !fallbackCodes.has(code))) {
            throw Object.assign(new Error('Server export failed.'), { code });
          }
          setFallbackNotice('Server cache was unavailable, so this export was generated safely in your browser.');
        }

        cacheLayer = 'browser_worker';
        const file = await buildGraphExportViaWorker(
          artifact,
          format,
          (stage, percent) => updateState(format, { stage, progress: percent }),
          controller.signal
        );

        const exportBlob = new Blob([file.bytes as unknown as BlobPart], { type: file.mediaType });
        let expiresAt: string | null = null;
        if (
          browserRetention.enabled &&
          browserRetention.artifactKey &&
          browserRetention.expiresAt &&
          browserRetention.expiresAt > Date.now()
        ) {
          try {
            await saveBrowserExport({
              id: createBrowserExportId(browserRetention.artifactKey, format),
              artifactKey: browserRetention.artifactKey,
              sourceType: origin,
              format,
              filename: file.filename,
              mediaType: file.mediaType,
              sha256: file.sha256,
              blob: exportBlob,
              byteSize: file.byteSize,
              createdAt: Date.now(),
              expiresAt: browserRetention.expiresAt,
              lastAccessedAt: Date.now(),
            });
            expiresAt = new Date(browserRetention.expiresAt).toISOString();
          } catch {
            setCacheWarning('The export downloaded successfully, but this browser could not retain a cached copy.');
          }
        }

        downloadBlob(exportBlob, file.filename);
        updateState(format, {
          status: 'success',
          progress: 100,
          stage: 'complete',
          cacheHit: false,
          cacheLayer,
          sha256: file.sha256,
          byteSize: file.byteSize,
          expiresAt,
        });
        recordAnalytics(format, cacheLayer, false, true, startedAt, file.byteSize);
    } catch (error) {
      if ((error as Error).name === 'AbortError' || controller.signal.aborted) {
        updateState(format, emptyState());
          return;
        }
        updateState(format, { status: 'error', error: friendlyError(error) });
        recordAnalytics(format, cacheLayer, false, false, startedAt, 0);
      } finally {
        if (abortControllers.current[format] === controller) {
          delete abortControllers.current[format];
        }
      }
    },
    [artifact, browserRetention, manifest, origin, publicIdentity, recordAnalytics, updateState]
  );

  const handleCancel = useCallback((format: GraphExportFormat) => {
    abortControllers.current[format]?.abort();
  }, []);

  const handleTextReport = useCallback(() => {
    if (!artifact) return;
    const repoName =
      ((artifact as unknown as { repository?: { name?: string } }).repository?.name ?? 'repository').replace(
        /[^a-z0-9._-]+/gi,
        '-'
      ) || 'repository';
    const text = generateTextReport(artifact as never);
    const blob = new Blob([text], { type: 'text/plain; charset=utf-8' });
    downloadBlob(blob, `${repoName}-repodna-architecture.txt`);
  }, [artifact]);

  return (
    <div className="graph-export-overlay" role="presentation" onPointerDown={closeDialog}>
      <div
        ref={dialogRef}
        className="graph-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="graph-export-title"
        aria-describedby="graph-export-description"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="graph-export-header">
          <div>
            <p className="eyebrow cyan-text">Portable graph data</p>
            <h2 id="graph-export-title">Export graph</h2>
          </div>
          <button className="graph-export-close" onClick={closeDialog} aria-label="Close export dialog" type="button">
            ×
          </button>
        </div>

        <p id="graph-export-description" className="graph-export-intro">Export full dependency graph.</p>
        <p className="graph-export-note">
          Includes all analyzed nodes and relationships, including items hidden by filters or rendering limits.
        </p>

        {manifest ? (
          <div className="graph-export-stats" aria-label="Graph export summary">
            <span><strong>{manifest.counts.nodes}</strong> nodes</span>
            <span><strong>{manifest.counts.relationships}</strong> relationships</span>
            <span><strong>{manifest.counts.groups}</strong> groups</span>
            <span><strong>{manifest.counts.unresolved}</strong> unresolved</span>
            <span><strong>{manifest.coverage.percentage}%</strong> coverage</span>
            <span>{manifest.completeness.status}</span>
          </div>
        ) : null}

        {manifest?.adaptedFromLegacy ? (
          <p className="graph-export-warning">
            This analysis originated from the legacy graph schema. Exported relationships are complete for the loaded artifact, but some evidence fields may be less detailed.
          </p>
        ) : null}
        {browserRetention.enabled && !browserRetention.artifactKey ? (
          <p className="graph-export-warning" role="status">
            This graph could not be retained on this device. Exports still download normally and are not uploaded.
          </p>
        ) : null}
        {fallbackNotice ? <p className="graph-export-fallback" role="status">{fallbackNotice}</p> : null}
        {cacheWarning ? <p className="graph-export-warning" role="status">{cacheWarning}</p> : null}

        <div className="graph-export-actions">
          {visibleFormats.map((format) => {
            const state = states[format];
            const label = FORMAT_LABELS[format];
            return (
              <section key={format} className="graph-export-row" aria-label={label.label}>
                <div className="graph-export-row-info">
                  <strong>{label.label}</strong>
                  <span>{label.description}</span>
                  {state.status === 'loading' ? (
                    <span className="graph-export-progress" role="status" aria-live="polite">
                      <span style={{ width: `${state.progress}%` }} />
                      {state.stage.replaceAll('_', ' ')} · {state.progress}%
                    </span>
                  ) : null}
                  {state.status === 'success' ? (
                    <span className="graph-export-meta" role="status">
                      <span className="graph-export-badge">
                        {state.cacheHit ? 'cache hit' : 'generated now'}
                      </span>
                      {state.cacheLayer ? <span>{state.cacheLayer.replace('_', ' ')}</span> : null}
                      {state.byteSize !== null ? <span>{new Intl.NumberFormat().format(state.byteSize)} bytes</span> : null}
                      {state.sha256 ? <span title={state.sha256}>SHA-256 {state.sha256.slice(0, 12)}…</span> : null}
                      {state.expiresAt ? <span>expires {new Date(state.expiresAt).toLocaleDateString()}</span> : null}
                    </span>
                  ) : null}
                  {state.status === 'error' && state.error ? (
                    <span className="graph-export-error" role="alert">{state.error}</span>
                  ) : null}
                </div>
                <div className="graph-export-row-buttons">
                  {state.status === 'loading' ? (
                    <button type="button" className="chip-button" onClick={() => handleCancel(format)}>Cancel</button>
                  ) : (
                    <button type="button" className="chip-button" onClick={() => void handleExport(format)} disabled={!artifact}>
                      {state.status === 'error' ? 'Retry' : `Export ${label.label}`}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
          <section className="graph-export-row" aria-label="Architecture TXT">
            <div className="graph-export-row-info">
              <strong>Architecture TXT</strong>
              <span>Human-readable architecture report — deterministic plain text, no AI, includes inventory, coverage, and unresolved paths</span>
            </div>
            <div className="graph-export-row-buttons">
              <button type="button" className="chip-button" onClick={handleTextReport} disabled={!artifact}>
                Export TXT
              </button>
            </div>
          </section>
        </div>

        <div className="graph-export-foot">
          <span>CSV and Parquet download as ZIPs because each contains multiple relational tables.</span>
          <span>Cypher generation is deterministic and does not use an LLM or API key.</span>
        </div>
      </div>
    </div>
  );
}
