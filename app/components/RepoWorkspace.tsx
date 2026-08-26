'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import Link from 'next/link';

import { ArchitectureGraph } from './ArchitectureGraph';
import { CodeGraph } from './CodeGraph';
import { ConsentBanner } from './ConsentBanner';
import { FeedbackModal } from './FeedbackModal';
import { PrivateRepoPicker } from './PrivateRepoPicker';
import { analyzeGitHubUrl, analyzeUploadedFiles, analyzeZipBuffer, parseGitHubUrl } from '../lib/analyzer';
import type { RepoDNAProjectV2 } from '../lib/analyzer/v2/types';
import {
  analyzePublicRepositoryDurably,
  clearPendingDurableRun,
  DurableAnalysisUnavailableError,
  isRepoDNAProjectV2,
  readPendingDurableRun,
  type DurableRunReference,
} from '../lib/durable-analysis-client';
import { generateTextReport as generateTextReportImpl } from '../lib/export/text-report';
import { analyzePrivateRepositoryInBrowser, isDeepScanFailure } from '../lib/deep-scan-client';
import { projectV2ForWorkspace } from '../lib/schema/v2-viewer-projection';
import {
  ANALYSIS_COMPLETE_STEP,
  ANALYSIS_PROGRESS_STEPS,
  AnalysisCancelledError,
  assertArchitectureConsistency,
  runAnalysisLifecycle,
} from '../lib/analysis-lifecycle';
import {
  initAnalytics,
  identifyUser,
  trackAnalysisCompleted,
  trackAnalysisFailed,
  trackAnalysisIntent,
  trackArtifactExported,
  trackFallbackUsed,
  trackViewChanged,
} from '../lib/analytics';
import type {
  ArchitectureComponent,
  FileRecord,
  FlowRecord,
  RepoDNAProject,
  RouteRecord,
} from '../lib/types';

type View = 'overview' | 'architecture' | 'graph' | 'routes' | 'dependencies' | 'files';
type OverviewAudience = 'plain' | 'technical';

const navigation: { id: View; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'routes', label: 'Routes & trace' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'files', label: 'Files & symbols' },
  { id: 'graph', label: 'Code Graph' },
];

const DURABLE_STAGE_STEPS: Record<string, number> = {
  resolve: 0,
  download: 1,
  inventory: 2,
  parse: 3,
  resolve_relationships: 4,
  analytics: 5,
  validate: 5,
  complete: ANALYSIS_COMPLETE_STEP,
};

const methodTone: Record<string, string> = {
  GET: 'method-get',
  POST: 'method-post',
  PUT: 'method-put',
  PATCH: 'method-patch',
  DELETE: 'method-delete',
};

function formatNumber(value: number) {
  return Intl.NumberFormat('en-GB', { notation: value > 9999 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}

function matchesProject(value: unknown): value is RepoDNAProject {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RepoDNAProject>;
  return (
    typeof candidate.schemaVersion === 'string' &&
    !!candidate.repository?.name &&
    Array.isArray(candidate.files) &&
    Array.isArray(candidate.symbols) &&
    Array.isArray(candidate.imports) &&
    Array.isArray(candidate.calls) &&
    Array.isArray(candidate.routes) &&
    Array.isArray(candidate.entrypoints) &&
    Array.isArray(candidate.flows) &&
    Array.isArray(candidate.architecture?.components) &&
    Array.isArray(candidate.architecture?.connections) &&
    !!candidate.metrics &&
    Array.isArray(candidate.diagnostics) &&
    !!candidate.metadata?.fileComponents
  );
}

function matchesProjectV2(value: unknown): value is RepoDNAProjectV2 {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RepoDNAProjectV2>;
  return (
    candidate.schemaVersion === '2.0.0' &&
    !!candidate.repository?.name &&
    !!candidate.inventory &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges) &&
    Array.isArray(candidate.diagnostics) &&
    !!candidate.security
  );
}

function generateTextReport(project: RepoDNAProject | RepoDNAProjectV2): string {
  // Local import keeps the exporter out of the initial component graph.
  return generateTextReportImpl(project);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  // Give the browser a chance to start the download before releasing the blob.
  window.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

function generateMermaid(project: RepoDNAProject): string {
  const lines = ['flowchart TD'];
  project.architecture.components.forEach((comp) => {
    const id = comp.id.replace(/-/g, '_');
    const name = comp.name;
    const count = comp.files.length;
    lines.push(`    ${id}["${name} (${count} files)"]`);
  });
  project.architecture.connections.forEach((conn) => {
    const src = conn.source.replace(/-/g, '_');
    const tgt = conn.target.replace(/-/g, '_');
    const label = conn.weight > 1 ? `|${conn.weight}|` : '';
    lines.push(`    ${src} -->${label} ${tgt}`);
  });
  return lines.join('\n');
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('RepoDNA Error Boundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="fatal-state">
          <span>⚠️</span>
          <h1>Something went wrong</h1>
          <p>{this.state.error?.message ?? 'An unexpected error occurred while rendering the workspace.'}</p>
          <button
            className="primary-button"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            type="button"
          >
            Reload Application
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

// Landing View when no project is loaded
function LandingView({
  onAnalyzeGitHub,
  onAnalyzeFolder,
  onAnalyzeZip,
  onLoadDemo,
  onOpenPrivatePicker,
  onOpenFeedback,
  session,
}: {
  onAnalyzeGitHub: (url: string) => void;
  onAnalyzeFolder: (files: FileList) => void;
  onAnalyzeZip: (file: File) => void;
  onLoadDemo: () => void;
  onOpenPrivatePicker: () => void;
  onOpenFeedback: () => void;
  session: { user?: { name?: string; image?: string } } | null;
}) {
  const [url, setUrl] = useState('');
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (url.trim()) {
      onAnalyzeGitHub(url.trim());
    }
  }

  return (
    <main className="landing-shell">
      <header className="landing-topbar">
        <Link className="brand" href="/" aria-label="RepoDNA">
          <span className="brand-mark">R</span>
          <span className="brand-title">RepoDNA</span>
          <span className="version">v1.1 BETA</span>
        </Link>
        <div className="landing-nav-center">
          <button className="chip-button" onClick={onLoadDemo} type="button">
            <span>✨</span> Try Demo Project
          </button>
          <button
            className="chip-button"
            onClick={onOpenFeedback}
            type="button"
            style={{ fontSize: '0.8rem', padding: '5px 12px', color: '#fbbf24', borderColor: 'rgba(251, 191, 36, 0.4)' }}
          >
            <span>⭐</span> Feedback
          </button>
          <a
            href="https://github.com/AnasBabari/RepoDNA"
            target="_blank"
            rel="noreferrer"
            className="chip-button"
            style={{ fontSize: '0.8rem', padding: '5px 12px', textDecoration: 'none' }}
          >
            <span>★</span> GitHub
          </a>
        </div>

        <div className="landing-auth-right">
          {session?.user ? (
            <div className="flex items-center gap-2">
              {session.user.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={session.user.image}
                  alt={session.user.name || 'User avatar'}
                  style={{ width: '26px', height: '26px', borderRadius: '50%', border: '1px solid var(--cyan-border)' }}
                />
              )}
              <span style={{ fontSize: '0.85rem', color: 'var(--text-bright)' }}>
                {session.user.name || 'Developer'}
              </span>
              <button
                className="chip-button"
                onClick={onOpenPrivatePicker}
                type="button"
                style={{ fontSize: '0.8rem', padding: '5px 12px' }}
              >
                🔒 Your Repos
              </button>
            </div>
          ) : (
            <Link
              href="/api/auth/signin?callbackUrl=/"
              className="chip-button"
              style={{ fontSize: '0.8rem', padding: '5px 14px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <span>GitHub</span> Sign In (Beta)
            </Link>
          )}
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-badge">
          <span>◆</span> Deterministic Codebase Analysis · Zero Code Execution
        </div>
        <h1>
          Decode any repository<br />
          <span>visually in seconds.</span>
        </h1>
        <p className="subtitle">
          Statically analyze Python, JavaScript, and TypeScript repositories. Discover architecture layers, execution traces, dependencies, data models, and entry points.
        </p>

        <form className="landing-input-box" onSubmit={handleSubmit}>
          <span className="landing-input-glyph">⌕</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repository"
            autoFocus
          />
          <button className="analyse-button" type="submit">
            Analyze Repository <span>→</span>
          </button>
        </form>

        <div className="landing-chips-row">
          <span className="label">Featured repos:</span>
          <button
            className="chip-button"
            onClick={() => onAnalyzeGitHub('https://github.com/usestrix/strix')}
            type="button"
          >
            usestrix/strix
          </button>
          <button
            className="chip-button"
            onClick={() => onAnalyzeGitHub('https://github.com/karpathy/nanoGPT')}
            type="button"
          >
            karpathy/nanoGPT
          </button>
          <button
            className="chip-button"
            onClick={() => onAnalyzeGitHub('https://github.com/tiangolo/full-stack-fastapi-template')}
            type="button"
          >
            tiangolo/full-stack-fastapi-template
          </button>
          <button
            className="chip-button"
            onClick={onLoadDemo}
            type="button"
          >
            mixed-basic (demo)
          </button>
        </div>

        <div className="landing-dropzones-grid">
          <button
            className="dropzone-card"
            onClick={onOpenPrivatePicker}
            type="button"
          >
            <span className="icon">🔒</span>
            <strong>Private Repositories (Beta)</strong>
            <p>Select from your authorized GitHub private & public repositories</p>
          </button>

          <button
            className="dropzone-card"
            onClick={() => folderInputRef.current?.click()}
            type="button"
          >
            <span className="icon">📁</span>
            <strong>Select Local Directory</strong>
            <p>Analyze a local project folder directly in your browser tab</p>
          </button>
          <input
            ref={folderInputRef}
            hidden
            type="file"
            // @ts-expect-error webkitdirectory is standard for folder picker
            webkitdirectory="true"
            directory="true"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onAnalyzeFolder(e.target.files);
              }
            }}
          />

          <button
            className="dropzone-card"
            onClick={() => zipInputRef.current?.click()}
            type="button"
          >
            <span className="icon">📦</span>
            <strong>Upload Repository .zip or .json</strong>
            <p>Load a zipped source archive or existing RepoDNA JSON file</p>
          </button>
          <input
            ref={zipInputRef}
            hidden
            type="file"
            accept=".zip,application/zip,.json,application/json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                onAnalyzeZip(file);
              }
            }}
          />
        </div>

        <div className="landing-features-grid">
          <div className="feature-box">
            <span className="glyph">01 / SAFE</span>
            <strong>Zero Code Execution</strong>
            <p>The parser analyzes abstract source code syntax as text. It never runs scripts or executes packages.</p>
          </div>
          <div className="feature-box">
            <span className="glyph">02 / DEEP</span>
            <strong>Multi-Tier Execution Traces</strong>
            <p>Follow full execution paths from HTTP routes through controllers, services, repositories, and ORM models.</p>
          </div>
          <div className="feature-box">
            <span className="glyph">03 / EXPORT</span>
            <strong>Mermaid & Portable Artifacts</strong>
            <p>Export interactive architecture maps as Mermaid diagrams or standardized JSON for documentation and PRs.</p>
          </div>
        </div>
      </section>
    </main>
  );
}

const APP_BUILD_VERSION = 'v1.1.0-a91b35f';

// Analyzing Progress Screen
function AnalyzingView({
  target,
  step,
  error,
  errorCode,
  requestId,
  retryAfter,
  onRetry,
  onClientFallback,
  onCancel,
}: {
  target: string;
  step: number;
  error: string | null;
  errorCode?: string | null;
  requestId?: string | null;
  retryAfter?: number | null;
  onRetry: () => void;
  onClientFallback?: () => void;
  onCancel: () => void;
}) {
  const [copiedDiagnostic, setCopiedDiagnostic] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const diagnosticData = useMemo(() => {
    return {
      stage: step >= 0 && step < ANALYSIS_PROGRESS_STEPS.length ? ANALYSIS_PROGRESS_STEPS[step] : 'ingestion',
      errorCode: errorCode || 'UNKNOWN_ERROR',
      requestId: requestId || undefined,
      analysisMode: onClientFallback ? 'server' : 'client',
      appVersion: APP_BUILD_VERSION,
      timestamp: new Date().toISOString(),
      fallbackAvailable: Boolean(onClientFallback),
    };
  }, [step, errorCode, requestId, onClientFallback]);

  const copyDiagnostic = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnosticData, null, 2));
      setCopiedDiagnostic(true);
      setTimeout(() => setCopiedDiagnostic(false), 2500);
    } catch {}
  };

  return (
    <main className="landing-shell">
      <div className="analyzing-container">
        <div className="analyzing-mark">R</div>
        <h2>{error ? 'Analysis Failed' : 'Decoding Repository'}</h2>
        <p className="target-url">{target}</p>

        {error ? (
          <div>
            <div className="dialog-error" style={{ marginBottom: '20px', textAlign: 'left' }}>
              <strong>{errorCode ? `Error [${errorCode}]: ` : ''}</strong>
              {error}
              {retryAfter ? <div style={{ marginTop: '6px', opacity: 0.85 }}>Retry available in {retryAfter}s.</div> : null}
            </div>

            <div style={{ marginBottom: '20px', textAlign: 'left' }}>
              <button
                className="chip-button"
                onClick={() => setShowDiagnostics((prev) => !prev)}
                type="button"
                style={{ fontSize: '11px', padding: '4px 10px', marginBottom: '8px' }}
              >
                {showDiagnostics ? '▲ Hide Diagnostics' : '▼ View Technical Diagnostics'}
              </button>

              {showDiagnostics && (
                <div
                  style={{
                    background: 'rgba(6, 9, 13, 0.95)',
                    border: '1px solid var(--line)',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    fontSize: '12px',
                    color: '#94a3b8',
                    fontFamily: 'var(--font-geist-mono)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>Sanitized Diagnostic Info</span>
                    <button
                      className="export-pill-btn"
                      onClick={() => void copyDiagnostic()}
                      type="button"
                      style={{ fontSize: '11px', padding: '2px 8px' }}
                    >
                      {copiedDiagnostic ? '✓ Copied' : '📋 Copy Diagnostic'}
                    </button>
                  </div>
                  <pre style={{ margin: 0, overflowX: 'auto', fontSize: '11px', color: '#cbd5e1' }}>
                    {JSON.stringify(diagnosticData, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              {onClientFallback && (
                <button className="primary-button" onClick={onClientFallback} type="button">
                  ⚡ Analyze in Browser
                </button>
              )}
              <button className="chip-button" onClick={onRetry} type="button">
                Try Again
              </button>
              <button className="chip-button" onClick={onCancel} type="button">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <ul className="progress-steps-list">
              {ANALYSIS_PROGRESS_STEPS.map((text, idx) => {
                const isDone = idx < step;
                const isActive = idx === step;
                return (
                  <li
                    className={`progress-step-item ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}
                    key={text}
                  >
                    <span className="step-indicator">{isDone ? '✓' : idx + 1}</span>
                    <span>{text}</span>
                  </li>
                );
              })}
            </ul>
            <p className="analysis-stage-summary" aria-live="polite">
              {step >= ANALYSIS_COMPLETE_STEP
                ? 'All analysis and consistency checks completed.'
                : `Stage ${Math.min(step + 1, ANALYSIS_PROGRESS_STEPS.length)} of ${ANALYSIS_PROGRESS_STEPS.length}`}
            </p>
            <p className="privacy-note">
              <span>◆</span> Local-first & serverless analysis. Your source is never persisted.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

function RouteCoverageWarning({
  project,
  collapsible = false,
}: {
  project: RepoDNAProject;
  collapsible?: boolean;
}) {
  const mountWarnings = project.diagnostics.filter((item) =>
    ['DYNAMIC_ROUTE_MOUNT_UNRESOLVED', 'EXPRESS_ROUTE_MOUNT_UNRESOLVED'].includes(item.code)
  );
  const pathWarnings = project.diagnostics.filter((item) => item.code === 'EXPRESS_ROUTE_PATH_INCOMPLETE');
  const warnings = [...mountWarnings, ...pathWarnings];
  if (!warnings.length) return null;

  return (
    <section className="route-coverage-warning" role="alert" aria-label="Incomplete route analysis">
      <div className="route-coverage-icon">!</div>
      <div>
        <p className="eyebrow">Incomplete route map</p>
        <h2>
          {mountWarnings.length} Express mount{mountWarnings.length === 1 ? '' : 's'} could not be resolved
          {pathWarnings.length ? ` · ${pathWarnings.length} displayed path${pathWarnings.length === 1 ? '' : 's'} incomplete` : ''}
        </h2>
        <p>The affected paths are shown as partial, so the map does not imply they are verified public URLs.</p>
        {collapsible ? (
          <details>
            <summary>Review {warnings.length} technical detail{warnings.length === 1 ? '' : 's'}</summary>
            <ul>
              {warnings.slice(0, 10).map((warning, index) => (
                <li key={`${warning.file}-${warning.code}-${index}`}>
                  <code>{warning.file ?? 'unknown file'}</code>
                  <span>{warning.message}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <ul>
            {warnings.slice(0, 10).map((warning, index) => (
              <li key={`${warning.file}-${warning.code}-${index}`}>
                <code>{warning.file ?? 'unknown file'}</code>
                <span>{warning.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function isRoutePathIncomplete(project: RepoDNAProject, route: RouteRecord): boolean {
  const messagePrefix = `Full mounted path unresolved for ${route.method} ${route.path};`;
  return project.diagnostics.some((item) =>
    item.code === 'EXPRESS_ROUTE_PATH_INCOMPLETE' && item.file === route.file && item.message.startsWith(messagePrefix)
  );
}

function Overview({
  project,
  onOpenArchitecture,
  onOpenRoutes,
}: {
  project: RepoDNAProject;
  onOpenArchitecture: () => void;
  onOpenRoutes: () => void;
}) {
  const [audience, setAudience] = useState<OverviewAudience>('plain');
  const primaryEntry = project.entrypoints[0];
  const incompletePaths = project.diagnostics.filter((item) => item.code === 'EXPRESS_ROUTE_PATH_INCOMPLETE').length;
  // Truthful size classification per spec: use first-party source files AND LOC
  // Small: <50 files AND <10k LOC, Medium: 50–249 OR 10k–50k, Large: 250–999 OR 50k–250k, Very large: >=1000 OR >=250k
  const firstPartyFileCount = project.repository.sourceFileCount;
  const firstPartyLoc = project.files
    .filter((f) => ['Python', 'JavaScript', 'TypeScript', 'Go'].includes(f.language))
    .reduce((acc, f) => acc + f.lines, 0);
  const codebaseSize = (() => {
    if (firstPartyFileCount >= 1000 || firstPartyLoc >= 250_000) return 'Very large codebase';
    if (firstPartyFileCount >= 250 || firstPartyLoc >= 50_000) return 'Large codebase';
    if (firstPartyFileCount >= 50 || firstPartyLoc >= 10_000) return 'Medium codebase';
    return 'Small codebase';
  })();
  // Never display "Fully mapped" unless all supported first-party files parsed and no limits/truncation
  const hasSkippedDiagnostics = project.diagnostics.some(
    (d) => d.code.startsWith('skipped_') || ['TOO_MANY_FILES', 'TOO_MANY_ARCHIVE_ENTRIES', 'EXTRACTED_TOO_LARGE', 'ARCHIVE_TOO_LARGE', 'SOURCE_PARSE_PARTIAL', 'SOURCE_PARSE_FAILED', 'GRAPH_NODES_COMPACTED', 'GRAPH_EDGES_COMPACTED'].includes(d.code)
  );
  const hasUnresolvedRoutes = incompletePaths > 0;
  const isFullyMapped = project.metrics.parseSuccessRate === 100 && !hasSkippedDiagnostics && !hasUnresolvedRoutes;
  const mapQualityLabel = isFullyMapped ? 'Fully mapped' : hasUnresolvedRoutes || hasSkippedDiagnostics ? (project.metrics.parseSuccessRate < 70 ? 'Coverage limited' : 'Mostly mapped') : 'Mostly mapped';
  const primaryTechnology = project.technologies[0] ?? Object.keys(project.repository.languages)[0] ?? 'Custom application';

  return (
    <div className="view-stack overview-view">
      <section className="overview-toolbar" aria-label="Overview audience">
        <div>
          <p className="eyebrow cyan-text">Repository overview</p>
          <p>Choose how much implementation detail you want to see.</p>
        </div>
        <div className="audience-switch" role="group" aria-label="Explanation level">
          <button
            className={audience === 'plain' ? 'is-active' : ''}
            aria-pressed={audience === 'plain'}
            onClick={() => setAudience('plain')}
            type="button"
          >
            Simple
            <small>Plain language</small>
          </button>
          <button
            className={audience === 'technical' ? 'is-active' : ''}
            aria-pressed={audience === 'technical'}
            onClick={() => setAudience('technical')}
            type="button"
          >
            Technical
            <small>Metrics & evidence</small>
          </button>
        </div>
      </section>

      <section className="overview-hero">
        <div>
          <p className="eyebrow cyan-text">Analysis complete</p>
          <h1>{audience === 'plain' ? 'Here’s the shape of this repository.' : 'Repository analysis summary.'}</h1>
          <p className="hero-copy">
            {audience === 'plain'
              ? `RepoDNA found ${project.metrics.components} main areas and ${project.metrics.routes} request paths. Start with the visual map, then follow the suggested reading order.`
              : `Static analysis identified ${project.metrics.components} architectural regions, ${project.metrics.routes} routes, and ${formatNumber(project.metrics.symbols)} symbols without executing repository code.`}
          </p>
          <div className="overview-actions">
            <button className="primary-button" onClick={onOpenArchitecture} type="button">
              Open visual map <span>→</span>
            </button>
            <button className="secondary-button" onClick={onOpenRoutes} type="button">
              View request paths
            </button>
          </div>
        </div>
        <div className="analysis-trust-card">
          <span>✓</span>
          <div>
            <strong>Safe static analysis</strong>
            <p>No repository code or install scripts were run.</p>
          </div>
        </div>
      </section>

      {audience === 'plain' ? (
        <>
          <section className="plain-summary-grid" aria-label="Plain-language summary">
            <article>
              <span>Size</span>
              <strong>{codebaseSize}</strong>
              <p>{formatNumber(firstPartyFileCount)} first-party files · {formatNumber(firstPartyLoc)} LOC</p>
            </article>
            <article>
              <span>Built with</span>
              <strong>{primaryTechnology}</strong>
              <p>{project.technologies.length > 1 ? `Plus ${project.technologies.length - 1} other detected technologies.` : 'Primary detected technology.'}</p>
            </article>
            <article>
              <span>Map quality</span>
              <strong>{mapQualityLabel}</strong>
              <p>
                {isFullyMapped
                  ? 'No unresolved relationships; all supported first-party files parsed.'
                  : incompletePaths
                    ? `${incompletePaths} request path${incompletePaths === 1 ? '' : 's'} need verification.`
                    : hasSkippedDiagnostics
                      ? 'Some files were skipped or partially parsed — see diagnostics.'
                      : 'Most relationships resolved; see diagnostics for coverage.'}
              </p>
            </article>
          </section>

          <RouteCoverageWarning project={project} collapsible />

          <section className="panel reading-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Suggested path</p>
                <h2>What to open first</h2>
              </div>
              <span>{Math.min(3, project.onboarding.length)} steps</span>
            </div>
            <ol className="plain-reading-list">
              {project.onboarding.slice(0, 3).map((step) => (
                <li key={`${step.step}-${step.file}`}>
                  <span>{step.step}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <p>{step.file}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : (
        <>
          <section className="metric-grid" aria-label="Technical analysis summary">
            <article>
              <span>First-party source</span>
              <strong>{formatNumber(firstPartyFileCount)}</strong>
              <i>{formatNumber(firstPartyLoc)} LOC · {project.metrics.parseSuccessRate}% parsed · {formatNumber(project.repository.fileCount)} total files</i>
            </article>
            <article>
              <span>Dependencies</span>
              <strong>{formatNumber(project.metrics.localDependencies)}</strong>
              <i>{project.metrics.externalDependencies} external · {project.metrics.dependencyCycles.length} cycles</i>
            </article>
            <article>
              <span>Routes</span>
              <strong>{formatNumber(project.metrics.routes)}</strong>
              <i>{project.flows.length} traceable flows</i>
            </article>
            <article>
              <span>Complexity</span>
              <strong>{project.metrics.complexityScore}/100</strong>
              <i>Structural score</i>
            </article>
          </section>

          <RouteCoverageWarning project={project} collapsible />

          <div className="overview-columns">
            <section className="panel stack-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Detected stack</p>
                  <h2>Technologies & languages</h2>
                </div>
                <span>{project.technologies.length} detected</span>
              </div>
              <div className="technology-cloud">
                {project.technologies.length > 0 ? (
                  project.technologies.map((technology) => (
                    <span key={technology}>{technology}</span>
                  ))
                ) : (
                  <p className="empty-copy">No third-party frameworks detected.</p>
                )}
              </div>
              <div className="language-bars">
                {Object.entries(project.repository.languages).map(([language, percentage]) => (
                  <div key={language}>
                    <span>{language}</span>
                    <i><b style={{ width: `${percentage}%` }} /></i>
                    <strong>{percentage}%</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel start-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Execution</p>
                  <h2>Entrypoint & reading order</h2>
                </div>
                <span>{project.entrypoints.length} entrypoints</span>
              </div>
              {primaryEntry ? (
                <div className="entrypoint-card">
                  <span className="file-glyph">↳</span>
                  <div>
                    <strong>{primaryEntry.file}</strong>
                    <p>{primaryEntry.evidence[0] ?? 'Likely application entry point'}</p>
                  </div>
                  <i>{Math.round(primaryEntry.confidence * 100)}% match</i>
                </div>
              ) : (
                <p className="empty-copy">No confident application entry point was found.</p>
              )}
              <ol className="tour-list">
                {project.onboarding.slice(0, 3).map((step) => (
                  <li key={`${step.step}-${step.file}`}>
                    <span>0{step.step}</span>
                    <div>
                      <strong>{step.title}</strong>
                      <code>{step.file}</code>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <section className="panel important-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Structural importance</p>
                <h2>Highest-impact files</h2>
              </div>
              <span>Top {Math.min(5, project.important_files.length)}</span>
            </div>
            <div className="important-grid">
              {project.important_files.slice(0, 5).map((file, index) => (
                <article key={file.file}>
                  <span>0{index + 1}</span>
                  <strong>{file.file}</strong>
                  <p>{file.reasons.slice(0, 2).join(' · ')}</p>
                  <i>{file.score} pts</i>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function RoutesView({
  project,
  selected,
  onSelect,
}: {
  project: RepoDNAProject;
  selected: RouteRecord | null;
  onSelect: (route: RouteRecord) => void;
}) {
  const flow = selected
    ? project.flows.find((candidate) => candidate.name === `${selected.method} ${selected.path}`) ?? null
    : null;

  return (
    <div className="view-stack routes-view">
      <section className="view-heading">
        <div>
          <p className="eyebrow cyan-text">Request surface</p>
          <h1>Routes & execution traces</h1>
          <p>Select a route to follow the statically resolved call sequence.</p>
        </div>
        <span>{project.routes.length} routes</span>
      </section>
      <RouteCoverageWarning project={project} />
      <div className="route-layout">
        <section className="panel route-list-panel">
          <div className="table-head">
            <span>Method</span>
            <span>Path</span>
            <span>Handler</span>
            <span>Confidence</span>
          </div>
          {project.routes.map((route) => (
            <button
              className={`route-row ${selected?.id === route.id ? 'is-selected' : ''} ${isRoutePathIncomplete(project, route) ? 'is-incomplete' : ''}`}
              key={route.id}
              onClick={() => onSelect(route)}
              type="button"
            >
              <span className={`method ${methodTone[route.method] ?? ''}`}>{route.method}</span>
              <span className="route-path">
                <code>{route.path}</code>
                {isRoutePathIncomplete(project, route) && <small title="The runtime mount prefix could not be resolved">partial path</small>}
              </span>
              <span>{route.handler.split('::').at(-1)}</span>
              <i>{Math.round(route.confidence * 100)}%</i>
            </button>
          ))}
        </section>
        <section className="panel trace-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Trace flow</p>
              <h2>{flow?.name ?? 'Select a route'}</h2>
            </div>
            {flow && <span>{Math.round(flow.confidence * 100)}% trace confidence</span>}
          </div>
          {flow ? <FlowTimeline flow={flow} /> : <p className="empty-copy">Choose a route from the list to reveal its handler call path.</p>}
        </section>
      </div>
    </div>
  );
}

function FlowTimeline({ flow }: { flow: FlowRecord }) {
  return (
    <ol className="flow-timeline">
      {flow.nodes.map((node, index) => (
        <li key={node.id}>
          <div className="flow-index-bubble">{String(index + 1).padStart(2, '0')}</div>
          <div className="flow-node-content">
            <span className="flow-node-type">{node.type}</span>
            <div className="flow-node-label">{node.label}</div>
            <code className="flow-node-file">{node.file}:{node.line}</code>
          </div>
        </li>
      ))}
    </ol>
  );
}

function DependenciesView({ project }: { project: RepoDNAProject }) {
  const [query, setQuery] = useState('');
  const impacts = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return [];
    const matchingSymbols = project.symbols.filter((symbol) => symbol.name.toLowerCase().includes(value));
    const ids = new Set(matchingSymbols.map((symbol) => symbol.id));
    const files = new Set(matchingSymbols.map((symbol) => symbol.file));
    return [
      ...project.imports
        .filter((edge) => edge.target && files.has(edge.target))
        .map((edge) => ({ source: edge.source, relation: 'imports file' })),
      ...project.calls
        .filter((edge) => edge.target && ids.has(edge.target))
        .map((edge) => ({ source: edge.source, relation: 'calls symbol' })),
    ];
  }, [project, query]);

  const localImports = project.imports.filter((edge) => edge.target);

  return (
    <div className="view-stack dependencies-view">
      <section className="view-heading">
        <div>
          <p className="eyebrow cyan-text">Change impact</p>
          <h1>What depends on this?</h1>
          <p>Search any symbol or file to find structurally connected callers and importers.</p>
        </div>
      </section>

      <label className="impact-search">
        <span>⌕</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try UserService, checkout, App, user…"
        />
        {query && (
          <button className="impact-clear" onClick={() => setQuery('')} type="button" aria-label="Clear query">
            ✕
          </button>
        )}
      </label>

      {query && (
        <section className="panel impact-results">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Impact slice</p>
              <h2>{query}</h2>
            </div>
            <span>{impacts.length} dependent{impacts.length === 1 ? '' : 's'}</span>
          </div>
          {impacts.length ? (
            impacts.slice(0, 12).map((item, index) => (
              <div className="impact-row" key={`${item.source}-${index}`}>
                <code>{item.source}</code>
                <span>{item.relation}</span>
              </div>
            ))
          ) : (
            <p className="empty-copy">No statically resolved dependents found for &ldquo;{query}&rdquo;.</p>
          )}
        </section>
      )}

      <div className="dependency-columns">
        <section className="panel boundary-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Boundaries</p>
              <h2>Data & external systems</h2>
            </div>
            <span>{project.databases.length + project.external_systems.length} total</span>
          </div>
          {[...project.databases, ...project.external_systems].map((boundary) => (
            <article className="boundary-row" key={`${boundary.type}-${boundary.name}`}>
              <span>{boundary.type === 'database' ? 'DB' : 'EXT'}</span>
              <div>
                <strong>{boundary.name}</strong>
                <p>{boundary.evidence[0]?.file ?? 'Manifest evidence'}</p>
              </div>
              <i>{Math.round(boundary.confidence * 100)}%</i>
            </article>
          ))}
        </section>

        <section className="panel import-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">File graph</p>
              <h2>Resolved internal imports</h2>
            </div>
            <span>{localImports.length} edges</span>
          </div>
          <div className="import-list">
            {localImports.slice(0, 16).map((edge) => (
              <div key={edge.id}>
                <code>{edge.source}</code>
                <span>→</span>
                <code>{edge.target}</code>
              </div>
            ))}
          </div>
        </section>
      </div>

      {project.metrics.dependencyCycles.length > 0 && (
        <section className="panel cycle-panel">
          <p className="eyebrow">Health signal</p>
          <h2>Dependency cycles</h2>
          {project.metrics.dependencyCycles.map((cycle, index) => (
            <code key={index}>{[...cycle, cycle[0]].join(' → ')}</code>
          ))}
        </section>
      )}
    </div>
  );
}

function FilesView({
  project,
  search,
  onSelect,
}: {
  project: RepoDNAProject;
  search: string;
  onSelect: (file: FileRecord) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(100);

  const filtered = useMemo(() => {
    const query = search.toLowerCase();
    return project.files.filter(
      (file) =>
        !query ||
        file.path.toLowerCase().includes(query) ||
        file.language.toLowerCase().includes(query)
    );
  }, [project.files, search]);

  const symbolsByFile = useMemo(
    () =>
      project.symbols.reduce<Record<string, number>>((counts, symbol) => {
        counts[symbol.file] = (counts[symbol.file] ?? 0) + (symbol.type === 'module' ? 0 : 1);
        return counts;
      }, {}),
    [project.symbols]
  );

  return (
    <div className="view-stack files-view">
      <section className="view-heading">
        <div>
          <p className="eyebrow cyan-text">Repository index</p>
          <h1>Files & symbols</h1>
          <p>Every source record is linked back to static analysis evidence.</p>
        </div>
        <span>{filtered.length} total</span>
      </section>
      <section className="panel file-table">
        <div className="file-row file-header">
          <span>File</span>
          <span>Language</span>
          <span>Lines</span>
          <span>Symbols</span>
          <span>Status</span>
        </div>
        {filtered.slice(0, visibleCount).map((file) => (
          <button
            className="file-row"
            key={file.id}
            onClick={() => onSelect(file)}
            type="button"
          >
            <code>{file.path}</code>
            <span>{file.language}</span>
            <span>{file.lines}</span>
            <span>{symbolsByFile[file.path] ?? 0}</span>
            <i className={file.parsed || file.language === 'Configuration' ? 'status-ok' : 'status-warn'}>
              {file.error ? 'Skipped' : file.parsed ? 'Parsed' : 'Indexed'}
            </i>
          </button>
        ))}
        {filtered.length > visibleCount && (
          <div style={{ padding: '12px 18px', textAlign: 'center', borderTop: '1px solid var(--line)' }}>
            <button
              className="export-pill-btn"
              onClick={() => setVisibleCount((prev) => prev + 100)}
              type="button"
            >
              Load more files ({filtered.length - visibleCount} remaining)
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function DetailPanel({
  component,
  route,
  file,
  project,
  onTrace,
}: {
  component: ArchitectureComponent | null;
  route: RouteRecord | null;
  file: FileRecord | null;
  project: RepoDNAProject;
  onTrace: () => void;
}) {
  if (route) {
    return (
      <aside className="detail-panel">
        <p className="eyebrow">Selected route</p>
        <div className="detail-icon route-icon">↳</div>
        <h2>{route.method} {route.path}</h2>
        <p className="muted">{route.framework} handler at {route.file}:{route.line}</p>
        <dl>
          <div>
            <dt>Handler</dt>
            <dd>{route.handler.split('::').at(-1)}</dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd className="good">{Math.round(route.confidence * 100)}%</dd>
          </div>
          <div>
            <dt>Framework</dt>
            <dd>{route.framework}</dd>
          </div>
        </dl>
        <button className="trace-button" onClick={onTrace} type="button">
          View full trace <span>↗</span>
        </button>
      </aside>
    );
  }

  if (file) {
    const symbols = project.symbols.filter((symbol) => symbol.file === file.path && symbol.type !== 'module');
    return (
      <aside className="detail-panel">
        <p className="eyebrow">Selected file</p>
        <div className="detail-icon file-icon">F</div>
        <h2>{file.path.split('/').at(-1)}</h2>
        <p className="muted detail-path">{file.path}</p>
        <dl>
          <div>
            <dt>Language</dt>
            <dd>{file.language}</dd>
          </div>
          <div>
            <dt>Lines</dt>
            <dd>{file.lines}</dd>
          </div>
          <div>
            <dt>Symbols</dt>
            <dd>{symbols.length}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd className="good">{file.parsed ? 'Parsed' : 'Indexed'}</dd>
          </div>
        </dl>
        <p className="eyebrow section-label">Extracted symbols</p>
        <ul className="evidence-list">
          {symbols.slice(0, 8).map((symbol) => (
            <li key={symbol.id}>
              {symbol.type} · {symbol.name} · L{symbol.line}
            </li>
          ))}
        </ul>
      </aside>
    );
  }

  if (!component) {
    return (
      <aside className="detail-panel">
        <p className="eyebrow">Inspector</p>
        <p className="muted">Select any component, route, or file to inspect its architectural evidence.</p>
      </aside>
    );
  }

  return (
    <aside className="detail-panel">
      <p className="eyebrow">Selected component</p>
      <div className="detail-icon">{component.name.slice(0, 1)}</div>
      <h2>{component.name}</h2>
      <p className="muted">
        Inferred structural cluster based on source paths, symbol definitions, and dependency directions.
      </p>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>{component.type}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd className="good">{Math.round(component.confidence * 100)}%</dd>
        </div>
        <div>
          <dt>Files</dt>
          <dd>{component.files.length}</dd>
        </div>
      </dl>
      <p className="eyebrow section-label">Evidence & Files</p>
      <ul className="evidence-list">
        {component.evidence.map((item) => (
          <li key={item}>{item}</li>
        ))}
        {component.files.slice(0, 4).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <button className="trace-button" onClick={onTrace} type="button">
        Trace this component <span>↗</span>
      </button>
    </aside>
  );
}

function AnalyseDialog({
  open,
  onClose,
  onAnalyzeUrl,
  onImportFile,
}: {
  open: boolean;
  onClose: () => void;
  onAnalyzeUrl: (url: string) => void;
  onImportFile: (file: File) => void;
}) {
  const [githubUrl, setGithubUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (githubUrl.trim()) {
      onAnalyzeUrl(githubUrl.trim());
      onClose();
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="analyse-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="analyse-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="dialog-close" onClick={onClose} aria-label="Close dialog" type="button">
          ✕
        </button>
        <p className="eyebrow cyan-text">New analysis</p>
        <h2 id="analyse-title">Map a repository</h2>
        <p>RepoDNA statically analyzes source code as text and never executes runtime scripts.</p>

        <form onSubmit={handleSubmit}>
          <label className="github-field">
            <span>GitHub URL or owner/repo</span>
            <input
              value={githubUrl}
              onChange={(event) => setGithubUrl(event.target.value)}
              placeholder="https://github.com/owner/repository"
              autoFocus
            />
          </label>
          <button className="analyse-button" style={{ width: '100%', marginTop: '14px' }} type="submit">
            Analyze URL <span>→</span>
          </button>
        </form>

        <div className="dialog-divider">
          <span>or load local files</span>
        </div>

        <button className="import-drop" onClick={() => fileRef.current?.click()} type="button">
          <span>↑</span>
          <strong>Open .zip or repodna.json</strong>
          <small>Load a source archive or analysis into this visualizer</small>
        </button>
        <input
          ref={fileRef}
          hidden
          type="file"
          accept=".zip,application/zip,.json,application/json"
          onChange={(event) => {
            const f = event.target.files?.[0];
            if (f) {
              onImportFile(f);
              onClose();
            }
          }}
        />

        <p className="privacy-note">
          <span>◆</span> Local-first & client-side: analysis runs in your browser.
        </p>
      </section>
    </div>
  );
}

interface UserSession {
  user?: {
    id?: string;
    name?: string;
    image?: string;
  };
}

function useAuthSession() {
  const [session, setSession] = useState<UserSession | null>(null);

  useEffect(() => {
    async function loadSession() {
      try {
        const res = await fetch('/api/auth/session');
        if (res.ok) {
          const data = (await res.json()) as UserSession;
          if (data && Object.keys(data).length > 0 && data.user) {
            setSession(data);
            if (data.user.id) {
              identifyUser(data.user.id);
            }
          }
        }
      } catch {
        setSession(null);
      }
    }
    loadSession();
  }, []);

  return { session, setSession };
}

function WorkspaceContent() {
  const { session, setSession } = useAuthSession();
  const [project, setProject] = useState<RepoDNAProject | null>(null);
  const [deepProject, setDeepProject] = useState<RepoDNAProjectV2 | null>(null);
  const [analyzingTarget, setAnalyzingTarget] = useState<string | null>(null);
  const [analyzingStep, setAnalyzingStep] = useState(0);
  const [analyzingError, setAnalyzingError] = useState<string | null>(null);
  const [analyzingErrorCode, setAnalyzingErrorCode] = useState<string | null>(null);
  const [analyzingRequestId, setAnalyzingRequestId] = useState<string | null>(null);
  const [analyzingRetryAfter, setAnalyzingRetryAfter] = useState<number | null>(null);

  const [view, setView] = useState<View>('overview');
  const [search, setSearch] = useState('');
  const [selectedComponent, setSelectedComponent] = useState<ArchitectureComponent | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<RouteRecord | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copiedMermaid, setCopiedMermaid] = useState(false);
  const [privatePickerOpen, setPrivatePickerOpen] = useState(false);
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeAnalysisRef = useRef<AbortController | null>(null);

  useEffect(() => {
    initAnalytics();
    return () => activeAnalysisRef.current?.abort();
  }, []);

  function beginAnalysis(target: string): AbortController {
    activeAnalysisRef.current?.abort();
    const controller = new AbortController();
    activeAnalysisRef.current = controller;
    setAnalyzingTarget(target);
    setAnalyzingStep(0);
    setAnalyzingError(null);
    setAnalyzingErrorCode(null);
    setAnalyzingRequestId(null);
    setAnalyzingRetryAfter(null);
    setDeepProject(null);
    return controller;
  }

  function isActiveAnalysis(controller: AbortController): boolean {
    return activeAnalysisRef.current === controller && !controller.signal.aborted;
  }

  async function analyzeThroughSplash(
    controller: AbortController,
    analyze: () => Promise<RepoDNAProject>
  ): Promise<RepoDNAProject> {
    return runAnalysisLifecycle({
      analyze,
      validate: assertArchitectureConsistency,
      signal: controller.signal,
      onStep: (step) => {
        if (isActiveAnalysis(controller)) setAnalyzingStep((current) => Math.max(current, step));
      },
    });
  }

  function revealProject(
    controller: AbortController,
    analyzedProject: RepoDNAProject,
    canonicalProject: RepoDNAProjectV2 | null = null
  ) {
    if (!isActiveAnalysis(controller)) return;
    activeAnalysisRef.current = null;
    setAnalyzingTarget(null);
    setProject(analyzedProject);
    setDeepProject(canonicalProject);
    setView('overview');
    setSearch('');
    setSelectedComponent(
      analyzedProject.architecture.components.find((component) => component.type === 'api') ??
        analyzedProject.architecture.components[0] ??
        null
    );
    setSelectedRoute(analyzedProject.routes[0] ?? null);
  }

  function showAnalysisError(controller: AbortController, error: unknown, fallbackMessage: string) {
    if (!isActiveAnalysis(controller) || error instanceof AnalysisCancelledError) return;
    setAnalyzingError(error instanceof Error ? error.message : fallbackMessage);
  }

  // Check URL query parameters (e.g. ?repo=https://github.com/owner/repo)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const repoParam = params.get('repo') || params.get('url');
      if (repoParam) {
        void handleAnalyzeGitHub(repoParam);
        return;
      }
      const pendingRun = readPendingDurableRun();
      if (pendingRun) void handleResumeDurableRun(pendingRun);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleResumeDurableRun(run: DurableRunReference) {
    const controller = beginAnalysis(run.targetUrl);
    setAnalyzingRequestId(run.runId);
    try {
      const canonicalProject = await analyzePublicRepositoryDurably({
        targetUrl: run.targetUrl,
        signal: controller.signal,
        resume: run,
        onProgress: (event) => {
          const step = DURABLE_STAGE_STEPS[event.stage];
          if (typeof step === 'number' && isActiveAnalysis(controller)) {
            setAnalyzingStep((current) => Math.max(current, step));
          }
          if (event.status === 'failed' && isActiveAnalysis(controller)) {
            setAnalyzingErrorCode(event.code ?? 'WORKFLOW_FAILED');
          }
        },
      });
      const viewerProject = projectV2ForWorkspace(canonicalProject);
      assertArchitectureConsistency(viewerProject);
      revealProject(controller, viewerProject, canonicalProject);
    } catch (error) {
      showAnalysisError(controller, error, 'Could not resume this repository analysis.');
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
      if (event.key === 'Escape') {
        if (dialogOpen) setDialogOpen(false);
        if (privatePickerOpen) setPrivatePickerOpen(false);
        if (feedbackModalOpen) setFeedbackModalOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialogOpen, privatePickerOpen, feedbackModalOpen]);

  function handleSwitchView(newView: View) {
    setView(newView);
    trackViewChanged(newView);
  }

  const SAMPLE_ARTIFACTS: Record<string, string> = {
    'https://github.com/usestrix/strix': '/samples/strix.json',
    'https://github.com/karpathy/nanoGPT': '/samples/nanogpt.json',
    'https://github.com/karpathy/nanogpt': '/samples/nanogpt.json',
    'https://github.com/tiangolo/full-stack-fastapi-template': '/samples/full-stack-fastapi-template.json',
    'https://github.com/pytorch/pytorch': '/samples/pytorch.json',
    'https://github.com/fastapi/fastapi': '/samples/fastapi.json',
    'https://github.com/expressjs/express': '/samples/express.json',
    'https://github.com/yusrababari/Twitter-Sentiment-Analysis': '/samples/twitter-sentiment.json',
    'usestrix/strix': '/samples/strix.json',
    'karpathy/nanoGPT': '/samples/nanogpt.json',
    'karpathy/nanogpt': '/samples/nanogpt.json',
    'tiangolo/full-stack-fastapi-template': '/samples/full-stack-fastapi-template.json',
    'pytorch/pytorch': '/samples/pytorch.json',
    'fastapi/fastapi': '/samples/fastapi.json',
    'expressjs/express': '/samples/express.json',
    'yusrababari/Twitter-Sentiment-Analysis': '/samples/twitter-sentiment.json',
  };

  async function handleAnalyzeGitHub(url: string, forceClientOnly = false) {
    const cleanUrl = url.trim();
    const parsed = parseGitHubUrl(cleanUrl);
    const targetUrl = parsed ? `https://github.com/${parsed.owner}/${parsed.repo}` : cleanUrl;
    const shortKey = parsed ? `${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}` : '';
    const canonicalFull = parsed ? `https://github.com/${parsed.owner}/${parsed.repo}`.toLowerCase() : '';

    const startTime = Date.now();
    const controller = beginAnalysis(targetUrl);
    let failureCode = 'CLIENT_ERROR';
    let loadedSample = false;
    let canonicalProject: RepoDNAProjectV2 | null = null;
    trackAnalysisIntent('github_public');

    try {
      const analyzedProject = await analyzeThroughSplash(controller, async () => {
        // Check pre-cached sample artifacts without bypassing the shared progress lifecycle.
        if (!forceClientOnly) {
          const samplePath =
            SAMPLE_ARTIFACTS[targetUrl] ||
            SAMPLE_ARTIFACTS[canonicalFull] ||
            (shortKey ? SAMPLE_ARTIFACTS[shortKey] : undefined) ||
            SAMPLE_ARTIFACTS[cleanUrl] ||
            SAMPLE_ARTIFACTS[cleanUrl.replace(/\/$/, '')];

          if (samplePath) {
            try {
              const sampleRes = await fetch(samplePath, { signal: controller.signal });
              if (sampleRes.ok) {
                const parsedSample = (await sampleRes.json()) as unknown;
                if (matchesProjectV2(parsedSample)) {
                  loadedSample = true;
                  canonicalProject = parsedSample;
                  return projectV2ForWorkspace(parsedSample);
                }
                if (matchesProject(parsedSample)) {
                  loadedSample = true;
                  return parsedSample;
                }
              }
            } catch {
              if (controller.signal.aborted) throw new AnalysisCancelledError();
              // Continue with standard fetch if a sample artifact is unavailable.
            }
          }
        }

        if (forceClientOnly) return analyzeGitHubUrl(targetUrl);

        try {
          canonicalProject = await analyzePublicRepositoryDurably({
            targetUrl,
            signal: controller.signal,
            onRun: (run) => {
              if (isActiveAnalysis(controller)) setAnalyzingRequestId(run.runId);
            },
            onProgress: (event) => {
              const step = DURABLE_STAGE_STEPS[event.stage];
              if (typeof step === 'number' && isActiveAnalysis(controller)) {
                setAnalyzingStep((current) => Math.max(current, step));
              }
              if (event.status === 'failed' && isActiveAnalysis(controller)) {
                setAnalyzingErrorCode(event.code ?? 'WORKFLOW_FAILED');
              }
            },
          });
          return projectV2ForWorkspace(canonicalProject);
        } catch (error) {
          if (controller.signal.aborted) throw new AnalysisCancelledError();
          if (error instanceof DurableAnalysisUnavailableError) {
            failureCode = error.code;
            setAnalyzingRetryAfter(error.retryAfter ?? null);
            if (!error.fallbackAvailable) {
              setAnalyzingErrorCode(error.code);
            }
          }
          // Preserve the proven v1 server/browser route while deep analysis is
          // disabled, unconfigured, or temporarily unavailable.
        }

        // Try the serverless analyzer first, then transparently fall back to the browser.
        interface ApiResponse {
          success?: boolean;
          project?: unknown;
          error?: { code?: string; message?: string; retryAfter?: number; fallbackAvailable?: boolean; requestId?: string };
        }

        let apiData: ApiResponse | null = null;
        let isServerError = false;

        try {
          const res = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: targetUrl }),
            signal: controller.signal,
          });

          apiData = (await res.json().catch(() => null)) as ApiResponse | null;
          if (res.ok && apiData?.success && matchesProject(apiData.project)) return apiData.project;
          isServerError = true;
        } catch {
          if (controller.signal.aborted) throw new AnalysisCancelledError();
          isServerError = true;
        }

        if (!isServerError) throw new Error('Analysis did not produce a valid project.');

        const errObj = apiData?.error ?? null;
        if (errObj?.requestId) {
          setAnalyzingRequestId(errObj.requestId);
        }

        const shouldAutoFallback =
          !errObj ||
          errObj.code === 'RATE_LIMITED' ||
          errObj.code === 'RATE_LIMIT_UNAVAILABLE' ||
          errObj.code === 'UPSTREAM_GITHUB_RATE_LIMITED' ||
          errObj.code === 'UPSTREAM_GITHUB_ERROR' ||
          errObj.code === 'FETCH_TIMEOUT' ||
          errObj.fallbackAvailable;

        if (!shouldAutoFallback) {
          // Private-repository rescue: if the server cannot read this repo but
          // the user is signed in, analyze transiently in this browser.
          const rescueable = errObj?.code === 'GITHUB_TOKEN_EXPIRED' || errObj?.code === 'GITHUB_FORBIDDEN' || errObj?.code === 'REPO_NOT_FOUND';
          if (rescueable && !forceClientOnly) {
            const outcome = await analyzePrivateRepositoryInBrowser({
              url: targetUrl,
              signal: controller.signal,
              onProgress: (p) => {
                const stepByStage: Record<string, number> = { download: 1, inventory: 2, parse: 3, resolve_relationships: 4, analytics: 5 };
                const step = stepByStage[p.stage];
                if (typeof step === 'number' && isActiveAnalysis(controller)) {
                  setAnalyzingStep((current) => Math.max(current, step));
                }
              },
            });
            if (!isDeepScanFailure(outcome)) {
              if (!isRepoDNAProjectV2(outcome.project)) {
                throw new Error('Private deep scan returned an invalid RepoDNA v2 artifact.');
              }
              canonicalProject = outcome.project;
              return projectV2ForWorkspace(outcome.project);
            }
            if (outcome.authState !== 'expired') {
              failureCode = outcome.code;
              setAnalyzingErrorCode(outcome.code);
              throw new Error(outcome.message);
            }
            // expired → surface structured code so UI offers Reconnect GitHub
          }
          failureCode = errObj?.code || 'UNKNOWN';
          setAnalyzingErrorCode(errObj?.code ?? null);
          setAnalyzingRetryAfter(errObj?.retryAfter ?? null);
          trackAnalysisFailed('github_public', failureCode, 'server_error');
          throw new Error(errObj?.message || 'Analysis failed on server.');
        }

        const fallbackReason =
          errObj?.code === 'RATE_LIMITED' || errObj?.code === 'UPSTREAM_GITHUB_RATE_LIMITED'
            ? 'rate_limited'
            : errObj?.code === 'FETCH_TIMEOUT'
              ? 'timeout'
              : errObj?.code === 'RATE_LIMIT_UNAVAILABLE'
                ? 'service_unavailable'
                : 'network_error';
        trackFallbackUsed(fallbackReason);

        try {
          return await analyzeGitHubUrl(targetUrl);
        } catch (clientError) {
          failureCode = errObj?.code || 'FALLBACK_FAILED';
          const message = errObj?.message || 'Server analysis failed and browser analysis could not complete.';
          setAnalyzingErrorCode(failureCode);
          setAnalyzingRetryAfter(errObj?.retryAfter ?? null);
          trackAnalysisFailed('github_public', failureCode, 'client_fallback');
          throw new Error(`${message} (In-browser error: ${clientError instanceof Error ? clientError.message : 'failed'})`);
        }
      });

      if (!isActiveAnalysis(controller)) return;
      revealProject(controller, analyzedProject, canonicalProject);

      trackAnalysisCompleted(
        loadedSample ? 'demo' : 'github_public',
        Date.now() - startTime,
        analyzedProject.repository.fileCount,
        session?.user?.id ? 'authenticated' : 'public'
      );
    } catch (err) {
      showAnalysisError(controller, err, 'Could not analyze this repository.');
      if (isActiveAnalysis(controller) && !(err instanceof AnalysisCancelledError)) {
        trackAnalysisFailed('github_public', failureCode, 'ingestion');
      }
    }
  }

  async function handleAnalyzeFolder(files: FileList) {
    const startTime = Date.now();
    const controller = beginAnalysis(`Local directory (${files.length} files)`);
    trackAnalysisIntent('local_folder');

    try {
      const analyzedProject = await analyzeThroughSplash(controller, () => analyzeUploadedFiles(files));
      if (!isActiveAnalysis(controller)) return;
      revealProject(controller, analyzedProject);

      trackAnalysisCompleted('local_folder', Date.now() - startTime, analyzedProject.repository.fileCount);
    } catch (err) {
      showAnalysisError(controller, err, 'Could not parse this directory.');
      if (isActiveAnalysis(controller) && !(err instanceof AnalysisCancelledError)) {
        trackAnalysisFailed('local_folder', 'DIRECTORY_PARSE_ERROR', 'client_local');
      }
    }
  }

  async function handleAnalyzeZipOrJson(file: File) {
    const startTime = Date.now();
    const controller = beginAnalysis(file.name);
    trackAnalysisIntent('zip_upload');

    try {
      const analyzedProject = await analyzeThroughSplash(controller, async () => {
        if (file.name.endsWith('.json')) {
          const text = await file.text();
          const parsed = JSON.parse(text) as unknown;
          if (!matchesProject(parsed)) throw new Error('Incompatible RepoDNA project schema.');
          return parsed;
        }

        const buffer = await file.arrayBuffer();
        return analyzeZipBuffer(buffer, file.name.replace(/\.zip$/i, ''));
      });
      if (!isActiveAnalysis(controller)) return;
      revealProject(controller, analyzedProject);

      trackAnalysisCompleted('zip_upload', Date.now() - startTime, analyzedProject.repository.fileCount);
    } catch (err) {
      showAnalysisError(controller, err, 'Could not process uploaded file.');
      if (isActiveAnalysis(controller) && !(err instanceof AnalysisCancelledError)) {
        trackAnalysisFailed('zip_upload', 'ZIP_PROCESS_ERROR', 'client_local');
      }
    }
  }

  async function handleLoadDemo() {
    const startTime = Date.now();
    const controller = beginAnalysis('Demo Project (mixed-basic)');
    trackAnalysisIntent('demo');
    try {
      const analyzedProject = await analyzeThroughSplash(controller, async () => {
        const res = await fetch('/demo-project.json', { signal: controller.signal });
        if (!res.ok) throw new Error('Could not fetch demo artifact.');
        const parsed = (await res.json()) as unknown;
        if (!matchesProject(parsed)) throw new Error('Incompatible demo project schema.');
        return parsed;
      });
      if (!isActiveAnalysis(controller)) return;
      revealProject(controller, analyzedProject);
      trackAnalysisCompleted('demo', Date.now() - startTime, analyzedProject.repository.fileCount);
    } catch (err) {
      showAnalysisError(controller, err, 'Failed to load demo project.');
      if (isActiveAnalysis(controller) && !(err instanceof AnalysisCancelledError)) {
        trackAnalysisFailed('demo', 'DEMO_LOAD_ERROR', 'client_local');
      }
    }
  }

  function selectComponent(component: ArchitectureComponent) {
    setSelectedComponent(component);
    setSelectedRoute(null);
    setSelectedFile(null);
  }

  function selectRoute(route: RouteRecord) {
    setSelectedRoute(route);
    setSelectedComponent(null);
    setSelectedFile(null);
  }

  function selectFile(file: FileRecord) {
    setSelectedFile(file);
    setSelectedRoute(null);
    setSelectedComponent(null);
  }

  async function copyMermaidDiagram() {
    if (!project) return;
    const mermaidText = generateMermaid(project);
    await navigator.clipboard.writeText(mermaidText);
    setCopiedMermaid(true);
    trackArtifactExported('mermaid');
    window.setTimeout(() => setCopiedMermaid(false), 2000);
  }

  function exportJsonArtifact() {
    if (!project) return;
    const canonicalArtifact = deepProject ?? project;
    const blob = new Blob([JSON.stringify(canonicalArtifact, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${project.repository.name}-repodna.json`);
    trackArtifactExported('json');
  }

  function exportTextReport() {
    if (!project) return;
    const report = generateTextReport(deepProject ?? project);
    const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, `${project.repository.name}-repodna-report.txt`);
    trackArtifactExported('txt');
  }

  // 1. If currently analyzing, show Analyzing Progress Screen
  if (analyzingTarget) {
    return (
      <>
        <AnalyzingView
          target={analyzingTarget}
          step={analyzingStep}
          error={analyzingError}
          errorCode={analyzingErrorCode}
          requestId={analyzingRequestId}
          retryAfter={analyzingRetryAfter}
          onRetry={() => {
            if (analyzingTarget.startsWith('http') || analyzingTarget.includes('/')) {
              handleAnalyzeGitHub(analyzingTarget);
            } else {
              handleLoadDemo();
            }
          }}
          onClientFallback={
            analyzingTarget.startsWith('http') || analyzingTarget.includes('/')
              ? () => handleAnalyzeGitHub(analyzingTarget, true)
              : undefined
          }
          onCancel={() => {
            activeAnalysisRef.current?.abort();
            activeAnalysisRef.current = null;
            clearPendingDurableRun();
            setAnalyzingTarget(null);
            setAnalyzingError(null);
            setAnalyzingErrorCode(null);
            setAnalyzingRequestId(null);
            setAnalyzingRetryAfter(null);
          }}
        />
        <ConsentBanner />
      </>
    );
  }

  // 2. If no project loaded, show clean Landing View
  if (!project) {
    return (
      <>
        <LandingView
          onAnalyzeGitHub={handleAnalyzeGitHub}
          onAnalyzeFolder={handleAnalyzeFolder}
          onAnalyzeZip={handleAnalyzeZipOrJson}
          onLoadDemo={handleLoadDemo}
          onOpenPrivatePicker={() => {
            if (session?.user) {
              setPrivatePickerOpen(true);
            } else {
              window.location.href = '/api/auth/signin?callbackUrl=/';
            }
          }}
          onOpenFeedback={() => setFeedbackModalOpen(true)}
          session={session}
        />
        <PrivateRepoPicker
          isOpen={privatePickerOpen}
          onClose={() => setPrivatePickerOpen(false)}
          onSelectRepo={(repoUrl) => handleAnalyzeGitHub(repoUrl)}
          onSignOut={() => setSession(null)}
        />
        <FeedbackModal
          isOpen={feedbackModalOpen}
          onClose={() => setFeedbackModalOpen(false)}
        />
        <ConsentBanner />
      </>
    );
  }

  // 3. Active Workspace View
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <Link className="brand" href="/" onClick={(e) => { e.preventDefault(); setProject(null); }} aria-label="RepoDNA overview">
            <span className="brand-mark">R</span>
            <span className="brand-title">RepoDNA</span>
            <span className="version">v1.1</span>
          </Link>
          <div className="repo-pill" title={project.repository.source}>
            <span className="status-dot" /> {project.repository.name}
          </div>
        </div>

        <div className="topbar-center">
          <label className="global-search">
            <span>⌕</span>
            <input
              ref={searchInputRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onFocus={() => handleSwitchView('files')}
              placeholder="Search files, symbols, routes…"
            />
            <kbd>⌘ K</kbd>
          </label>
        </div>

        <div className="topbar-actions">
          <button
            className="chip-button"
            onClick={() => setFeedbackModalOpen(true)}
            type="button"
            title="Give feedback or request features"
          >
            <span>⭐</span> Feedback
          </button>
          <button className="chip-button" onClick={exportJsonArtifact} type="button" title="Download portable JSON analysis">
            <span>↓</span> JSON
          </button>
          <button className="chip-button" onClick={exportTextReport} type="button" title="Download plain-text architecture report">
            <span>↓</span> TXT
          </button>
          <button className="analyse-button" onClick={() => setDialogOpen(true)} type="button">
            New analysis
          </button>
        </div>
      </header>

      <aside className="sidebar">
        <p className="eyebrow">Workspace</p>
        {navigation.map((item, index) => (
          <button
            className={`nav-item ${view === item.id ? 'active' : ''}`}
            key={item.id}
            onClick={() => handleSwitchView(item.id)}
            type="button"
          >
            <span className="nav-index">0{index + 1}</span>
            {item.label}
          </button>
        ))}
        {view !== 'overview' && (
          <>
            <div className="sidebar-divider" />
            <p className="eyebrow">Repository stats</p>
            <div className="repo-facts">
              <span><strong>{project.repository.sourceFileCount}</strong> source files</span>
              <span><strong>{project.metrics.symbols}</strong> symbols</span>
              <span><strong>{project.metrics.routes}</strong> routes</span>
            </div>
            <div className="privacy-card">
              <span className="shield">◆</span>
              <div>
                <strong>Client-Side & Safe</strong>
                <p>Zero runtime code execution.</p>
              </div>
            </div>
          </>
        )}
      </aside>

      <section className="workspace">
        {view === 'overview' && (
          <Overview
            project={project}
            onOpenArchitecture={() => handleSwitchView('architecture')}
            onOpenRoutes={() => handleSwitchView('routes')}
          />
        )}
        {view === 'architecture' && (
          <div className="architecture-view">
            <section className="view-heading">
              <div>
                <p className="eyebrow cyan-text">Interactive map</p>
                <h1>Architecture</h1>
                <p>Pan, zoom, drag and select a component to inspect its evidence.</p>
              </div>
              <div className="view-heading-actions">
                <button
                  className="export-pill-btn"
                  onClick={() => void copyMermaidDiagram()}
                  type="button"
                  title="Copy architecture as Mermaid flowchart"
                >
                  {copiedMermaid ? '✓ Copied Mermaid' : 'Copy Mermaid'}
                </button>
                <span>{project.architecture.components.length} components</span>
              </div>
            </section>
            <ArchitectureGraph
              key={project.repository.source || project.repository.name}
              components={project.architecture.components}
              connections={project.architecture.connections}
              selectedId={selectedComponent?.id ?? null}
              onSelect={selectComponent}
              repositoryId={project.repository.source || project.repository.name}
            />
          </div>
        )}
        {view === 'routes' && (
          <RoutesView project={project} selected={selectedRoute} onSelect={selectRoute} />
        )}
        {view === 'dependencies' && <DependenciesView project={project} />}
        {view === 'files' && <FilesView project={project} search={search} onSelect={selectFile} />}
        {view === 'graph' && <CodeGraph project={deepProject ?? project} />}
      </section>

      <DetailPanel
        component={selectedComponent}
        route={selectedRoute}
        file={selectedFile}
        project={project}
        onTrace={() => setView('routes')}
      />
      <AnalyseDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onAnalyzeUrl={handleAnalyzeGitHub}
        onImportFile={handleAnalyzeZipOrJson}
      />
      <PrivateRepoPicker
        isOpen={privatePickerOpen}
        onClose={() => setPrivatePickerOpen(false)}
        onSelectRepo={(repoUrl) => handleAnalyzeGitHub(repoUrl)}
        onSignOut={() => setSession(null)}
      />
      <FeedbackModal
        isOpen={feedbackModalOpen}
        onClose={() => setFeedbackModalOpen(false)}
      />
      <ConsentBanner />
    </main>
  );
}

export function RepoWorkspace() {
  return (
    <ErrorBoundary>
      <WorkspaceContent />
    </ErrorBoundary>
  );
}
