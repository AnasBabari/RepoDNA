'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

import Link from 'next/link';

import { ArchitectureGraph } from './ArchitectureGraph';
import { analyzeGitHubUrl, analyzeUploadedFiles, analyzeZipBuffer } from '../lib/analyzer';
import type {
  ArchitectureComponent,
  FileRecord,
  FlowRecord,
  RepoDNAProject,
  RouteRecord,
} from '../lib/types';

type View = 'overview' | 'architecture' | 'routes' | 'dependencies' | 'files';

const navigation: { id: View; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'routes', label: 'Routes & trace' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'files', label: 'Files & symbols' },
];

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
    Array.isArray(candidate.architecture?.components)
  );
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
}: {
  onAnalyzeGitHub: (url: string) => void;
  onAnalyzeFolder: (files: FileList) => void;
  onAnalyzeZip: (file: File) => void;
  onLoadDemo: () => void;
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
          <span className="version">WEB v1.0</span>
        </Link>
        <div className="flex items-center gap-3">
          <button className="chip-button" onClick={onLoadDemo} type="button">
            <span>✨</span> Try Demo Project
          </button>
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
          <span className="label">Quick samples:</span>
          <button
            className="chip-button"
            onClick={() => onAnalyzeGitHub('https://github.com/yusrababari/Twitter-Sentiment-Analysis')}
            type="button"
          >
            yusrababari/Twitter-Sentiment-Analysis
          </button>
          <button
            className="chip-button"
            onClick={() => onAnalyzeGitHub('https://github.com/expressjs/express')}
            type="button"
          >
            expressjs/express
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

// Analyzing Progress Screen
function AnalyzingView({
  target,
  step,
  error,
  errorCode,
  retryAfter,
  onRetry,
  onClientFallback,
  onCancel,
}: {
  target: string;
  step: number;
  error: string | null;
  errorCode?: string | null;
  retryAfter?: number | null;
  onRetry: () => void;
  onClientFallback?: () => void;
  onCancel: () => void;
}) {
  const steps = [
    'Connecting to repository source...',
    'Extracting source files and manifests...',
    'Parsing symbols, routes, and data models...',
    'Resolving imports and execution call graphs...',
    'Synthesizing architecture map & metrics...',
  ];

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
              {steps.map((text, idx) => {
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
            <p className="privacy-note">
              <span>◆</span> Local-first & serverless analysis. Your source is never persisted.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

function Overview({ project, onOpenArchitecture }: { project: RepoDNAProject; onOpenArchitecture: () => void }) {
  const primaryEntry = project.entrypoints[0];
  return (
    <div className="view-stack overview-view">
      <section className="overview-hero">
        <div>
          <p className="eyebrow cyan-text">Repository decoded</p>
          <h1>Understand the system<br />before touching code.</h1>
          <p className="hero-copy">
            RepoDNA discovered {project.metrics.components} architectural regions, {project.metrics.routes} routes, and{' '}
            {formatNumber(project.metrics.symbols)} symbols using deterministic static analysis.
          </p>
          <button className="primary-button" onClick={onOpenArchitecture} type="button">
            Explore architecture map <span>→</span>
          </button>
        </div>
        <div className="score-orbit" aria-label={`Repository complexity ${project.metrics.complexityScore} out of 100`}>
          <div className="score-ring" style={{ '--score': `${project.metrics.complexityScore * 3.6}deg` } as React.CSSProperties}>
            <span><strong>{project.metrics.complexityScore}</strong>/100</span>
          </div>
          <p>Structural complexity</p>
        </div>
      </section>

      <section className="metric-grid" aria-label="Analysis summary">
        <article>
          <span>Source files</span>
          <strong>{formatNumber(project.repository.sourceFileCount)}</strong>
          <i>{project.metrics.parseSuccessRate}% parsed</i>
        </article>
        <article>
          <span>Dependencies</span>
          <strong>{formatNumber(project.metrics.localDependencies)}</strong>
          <i>{project.metrics.externalDependencies} external</i>
        </article>
        <article>
          <span>Routes</span>
          <strong>{formatNumber(project.metrics.routes)}</strong>
          <i>{project.flows.length} traceable flows</i>
        </article>
        <article>
          <span>Cycles</span>
          <strong>{project.metrics.dependencyCycles.length}</strong>
          <i>{project.metrics.dependencyCycles.length ? 'Review recommended' : 'Clean architecture'}</i>
        </article>
      </section>

      <div className="overview-columns">
        <section className="panel stack-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Detected stack</p>
              <h2>Technologies & frameworks</h2>
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
              <h2>Start here</h2>
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
          <p className="eyebrow subheading">Recommended tour</p>
          <ol className="tour-list">
            {project.onboarding.slice(0, 4).map((step) => (
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
            <p className="eyebrow">Centrality</p>
            <h2>Files worth reading first</h2>
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
              className={`route-row ${selected?.id === route.id ? 'is-selected' : ''}`}
              key={route.id}
              onClick={() => onSelect(route)}
              type="button"
            >
              <span className={`method ${methodTone[route.method] ?? ''}`}>{route.method}</span>
              <code>{route.path}</code>
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

function WorkspaceContent() {
  const [project, setProject] = useState<RepoDNAProject | null>(null);
  const [analyzingTarget, setAnalyzingTarget] = useState<string | null>(null);
  const [analyzingStep, setAnalyzingStep] = useState(0);
  const [analyzingError, setAnalyzingError] = useState<string | null>(null);
  const [analyzingErrorCode, setAnalyzingErrorCode] = useState<string | null>(null);
  const [analyzingRetryAfter, setAnalyzingRetryAfter] = useState<number | null>(null);

  const [view, setView] = useState<View>('overview');
  const [search, setSearch] = useState('');
  const [selectedComponent, setSelectedComponent] = useState<ArchitectureComponent | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<RouteRecord | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copiedMermaid, setCopiedMermaid] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Check URL query parameters (e.g. ?repo=https://github.com/owner/repo)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const repoParam = params.get('repo') || params.get('url');
      if (repoParam) {
        handleAnalyzeGitHub(repoParam);
      }
    }
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
      if (event.key === 'Escape' && dialogOpen) {
        setDialogOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialogOpen]);

  async function handleAnalyzeGitHub(url: string, forceClientOnly = false) {
    setAnalyzingTarget(url);
    setAnalyzingStep(0);
    setAnalyzingError(null);
    setAnalyzingErrorCode(null);
    setAnalyzingRetryAfter(null);

    const stepInterval = setInterval(() => {
      setAnalyzingStep((prev) => (prev < 4 ? prev + 1 : prev));
    }, 400);

    try {
      let analyzedProject: RepoDNAProject | null = null;

      if (!forceClientOnly) {
        // 1. Try Next.js serverless API route first
        interface ApiResponse {
          success?: boolean;
          project?: unknown;
          error?: { code?: string; message?: string; retryAfter?: number };
        }

        let apiData: ApiResponse | null = null;
        let isServerError = false;

        try {
          const res = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
          });

          apiData = (await res.json().catch(() => null)) as ApiResponse | null;

          if (res.ok && apiData && apiData.success && matchesProject(apiData.project)) {
            analyzedProject = apiData.project;
          } else {
            isServerError = true;
          }
        } catch {
          isServerError = true;
        }

        if (isServerError) {
          const errObj = apiData && apiData.error ? apiData.error : null;
          // If rate limited or service unavailable, try in-browser fallback directly
          if (errObj?.code === 'RATE_LIMITED' || errObj?.code === 'RATE_LIMIT_UNAVAILABLE') {
            try {
              analyzedProject = await analyzeGitHubUrl(url);
            } catch (clientErr) {
              const code = errObj.code;
              const msg = errObj.message || 'Server rate limit reached and client fallback failed.';
              setAnalyzingErrorCode(code);
              setAnalyzingRetryAfter(errObj.retryAfter ?? null);
              throw new Error(`${msg} (Client fallback error: ${clientErr instanceof Error ? clientErr.message : 'failed'})`);
            }
          } else if (errObj) {
            setAnalyzingErrorCode(errObj.code ?? null);
            setAnalyzingRetryAfter(errObj.retryAfter ?? null);
            throw new Error(errObj.message || 'Analysis failed on server.');
          } else {
            // General network failure: try in-browser fallback
            analyzedProject = await analyzeGitHubUrl(url);
          }
        }
      } else {
        // Direct client-side analysis
        analyzedProject = await analyzeGitHubUrl(url);
      }

      if (!analyzedProject) {
        throw new Error('Analysis did not produce a valid project.');
      }

      clearInterval(stepInterval);
      setAnalyzingTarget(null);
      setProject(analyzedProject);
      setView('overview');
      setSearch('');
      setSelectedComponent(
        analyzedProject.architecture.components.find((c) => c.type === 'api') ??
          analyzedProject.architecture.components[0] ??
          null
      );
      setSelectedRoute(analyzedProject.routes[0] ?? null);
    } catch (err) {
      clearInterval(stepInterval);
      const message = err instanceof Error ? err.message : 'Could not analyze this repository.';
      setAnalyzingError(message);
    }
  }

  async function handleAnalyzeFolder(files: FileList) {
    setAnalyzingTarget(`Local directory (${files.length} files)`);
    setAnalyzingStep(1);
    setAnalyzingError(null);

    const stepInterval = setInterval(() => {
      setAnalyzingStep((prev) => (prev < 4 ? prev + 1 : prev));
    }, 300);

    try {
      const analyzedProject = await analyzeUploadedFiles(files);
      clearInterval(stepInterval);
      setAnalyzingTarget(null);
      setProject(analyzedProject);
      setView('overview');
      setSearch('');
      setSelectedComponent(analyzedProject.architecture.components[0] ?? null);
      setSelectedRoute(analyzedProject.routes[0] ?? null);
    } catch (err) {
      clearInterval(stepInterval);
      setAnalyzingError(err instanceof Error ? err.message : 'Could not parse this directory.');
    }
  }

  async function handleAnalyzeZipOrJson(file: File) {
    setAnalyzingTarget(file.name);
    setAnalyzingStep(1);
    setAnalyzingError(null);

    try {
      if (file.name.endsWith('.json')) {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!matchesProject(parsed)) throw new Error('Incompatible RepoDNA project schema.');
        setAnalyzingTarget(null);
        setProject(parsed);
        setView('overview');
        setSelectedComponent(parsed.architecture.components[0] ?? null);
        setSelectedRoute(parsed.routes[0] ?? null);
        return;
      }

      const buffer = await file.arrayBuffer();
      const analyzedProject = await analyzeZipBuffer(buffer, file.name.replace(/\.zip$/i, ''));
      setAnalyzingTarget(null);
      setProject(analyzedProject);
      setView('overview');
      setSelectedComponent(analyzedProject.architecture.components[0] ?? null);
      setSelectedRoute(analyzedProject.routes[0] ?? null);
    } catch (err) {
      setAnalyzingError(err instanceof Error ? err.message : 'Could not process uploaded file.');
    }
  }

  async function handleLoadDemo() {
    setAnalyzingTarget('Demo Project (mixed-basic)');
    setAnalyzingStep(2);
    setAnalyzingError(null);
    try {
      const res = await fetch('/demo-project.json');
      if (!res.ok) throw new Error('Could not fetch demo artifact.');
      const parsed = await res.json();
      if (!matchesProject(parsed)) throw new Error('Incompatible demo project schema.');
      setAnalyzingTarget(null);
      setProject(parsed);
      setView('overview');
      setSelectedComponent(
        parsed.architecture.components.find((c) => c.type === 'api') ??
          parsed.architecture.components[0] ??
          null
      );
      setSelectedRoute(parsed.routes[0] ?? null);
    } catch (err) {
      setAnalyzingError(err instanceof Error ? err.message : 'Failed to load demo project.');
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
    window.setTimeout(() => setCopiedMermaid(false), 2000);
  }

  function exportJsonArtifact() {
    if (!project) return;
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.repository.name}-repodna.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // 1. If currently analyzing, show Analyzing Progress Screen
  if (analyzingTarget) {
    return (
      <AnalyzingView
        target={analyzingTarget}
        step={analyzingStep}
        error={analyzingError}
        errorCode={analyzingErrorCode}
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
          setAnalyzingTarget(null);
          setAnalyzingError(null);
          setAnalyzingErrorCode(null);
          setAnalyzingRetryAfter(null);
        }}
      />
    );
  }

  // 2. If no project loaded, show clean Landing View
  if (!project) {
    return (
      <LandingView
        onAnalyzeGitHub={handleAnalyzeGitHub}
        onAnalyzeFolder={handleAnalyzeFolder}
        onAnalyzeZip={handleAnalyzeZipOrJson}
        onLoadDemo={handleLoadDemo}
      />
    );
  }

  // 3. Active Workspace View
  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" onClick={(e) => { e.preventDefault(); setProject(null); }} aria-label="RepoDNA overview">
          <span className="brand-mark">R</span>
          <span className="brand-title">RepoDNA</span>
          <span className="version">WEB v1.0</span>
        </Link>
        <label className="global-search">
          <span>⌕</span>
          <input
            ref={searchInputRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onFocus={() => setView('files')}
            placeholder="Search files, symbols, routes…"
          />
          <kbd>⌘ K</kbd>
        </label>
        <div className="repo-pill" title={project.repository.source}>
          <span className="status-dot" /> {project.repository.name}
        </div>
        <div className="topbar-actions">
          <button className="chip-button" onClick={exportJsonArtifact} type="button" title="Download portable JSON analysis">
            <span>↓</span> JSON
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
            onClick={() => setView(item.id)}
            type="button"
          >
            <span className="nav-index">0{index + 1}</span>
            {item.label}
          </button>
        ))}
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
      </aside>

      <section className="workspace">
        {view === 'overview' && (
          <Overview project={project} onOpenArchitecture={() => setView('architecture')} />
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
              components={project.architecture.components}
              connections={project.architecture.connections}
              selectedId={selectedComponent?.id ?? null}
              onSelect={selectComponent}
            />
          </div>
        )}
        {view === 'routes' && (
          <RoutesView project={project} selected={selectedRoute} onSelect={selectRoute} />
        )}
        {view === 'dependencies' && <DependenciesView project={project} />}
        {view === 'files' && <FilesView project={project} search={search} onSelect={selectFile} />}
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
