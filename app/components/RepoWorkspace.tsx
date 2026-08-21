'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { ArchitectureGraph } from './ArchitectureGraph';
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
  GET: 'method-get', POST: 'method-post', PUT: 'method-put', PATCH: 'method-patch', DELETE: 'method-delete',
};

function formatNumber(value: number) {
  return Intl.NumberFormat('en-GB', { notation: value > 9999 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}

function matchesProject(value: unknown): value is RepoDNAProject {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RepoDNAProject>;
  return typeof candidate.schemaVersion === 'string'
    && !!candidate.repository?.name
    && Array.isArray(candidate.files)
    && Array.isArray(candidate.architecture?.components);
}

function EmptyState() {
  return (
    <div className="loading-state" role="status">
      <span className="loading-mark">R</span>
      <strong>Loading the repository map</strong>
      <p>Reading the portable RepoDNA artifact. No repository code is being executed.</p>
    </div>
  );
}

function Overview({ project, onOpenArchitecture }: { project: RepoDNAProject; onOpenArchitecture: () => void }) {
  const primaryEntry = project.entrypoints[0];
  return (
    <div className="view-stack overview-view">
      <section className="overview-hero">
        <div>
          <p className="eyebrow cyan-text">Repository decoded</p>
          <h1>Understand the system<br />before touching the code.</h1>
          <p className="hero-copy">
            RepoDNA found {project.metrics.components} architectural regions, {project.metrics.routes} routes and{' '}
            {formatNumber(project.metrics.symbols)} symbols using static evidence only.
          </p>
          <button className="primary-button" onClick={onOpenArchitecture} type="button">Open architecture map <span>→</span></button>
        </div>
        <div className="score-orbit" aria-label={`Repository complexity ${project.metrics.complexityScore} out of 100`}>
          <div className="score-ring" style={{ '--score': `${project.metrics.complexityScore * 3.6}deg` } as React.CSSProperties}>
            <span><strong>{project.metrics.complexityScore}</strong>/100</span>
          </div>
          <p>Structural complexity</p>
        </div>
      </section>

      <section className="metric-grid" aria-label="Analysis summary">
        <article><span>Source files</span><strong>{formatNumber(project.repository.sourceFileCount)}</strong><i>{project.metrics.parseSuccessRate}% parsed</i></article>
        <article><span>Dependencies</span><strong>{formatNumber(project.metrics.localDependencies)}</strong><i>{project.metrics.externalDependencies} external</i></article>
        <article><span>Routes</span><strong>{formatNumber(project.metrics.routes)}</strong><i>{project.flows.length} traceable flows</i></article>
        <article><span>Cycles</span><strong>{project.metrics.dependencyCycles.length}</strong><i>{project.metrics.dependencyCycles.length ? 'Review recommended' : 'No cycles detected'}</i></article>
      </section>

      <div className="overview-columns">
        <section className="panel stack-panel">
          <div className="panel-heading"><div><p className="eyebrow">Detected stack</p><h2>Technologies</h2></div><span>{project.technologies.length}</span></div>
          <div className="technology-cloud">
            {project.technologies.map((technology) => <span key={technology}>{technology}</span>)}
          </div>
          <div className="language-bars">
            {Object.entries(project.repository.languages).map(([language, percentage]) => (
              <div key={language}><span>{language}</span><i><b style={{ width: `${percentage}%` }} /></i><strong>{percentage}%</strong></div>
            ))}
          </div>
        </section>

        <section className="panel start-panel">
          <div className="panel-heading"><div><p className="eyebrow">Execution</p><h2>Start here</h2></div><span>{project.entrypoints.length}</span></div>
          {primaryEntry ? (
            <div className="entrypoint-card">
              <span className="file-glyph">↳</span>
              <div><strong>{primaryEntry.file}</strong><p>{primaryEntry.evidence[0] ?? 'Likely application entry point'}</p></div>
              <i>{Math.round(primaryEntry.confidence * 100)}%</i>
            </div>
          ) : <p className="empty-copy">No confident application entry point was found.</p>}
          <p className="eyebrow subheading">Recommended tour</p>
          <ol className="tour-list">
            {project.onboarding.slice(0, 4).map((step) => (
              <li key={`${step.step}-${step.file}`}><span>0{step.step}</span><div><strong>{step.title}</strong><code>{step.file}</code></div></li>
            ))}
          </ol>
        </section>
      </div>

      <section className="panel important-panel">
        <div className="panel-heading"><div><p className="eyebrow">Centrality</p><h2>Files worth reading first</h2></div><span>Top {Math.min(5, project.important_files.length)}</span></div>
        <div className="important-grid">
          {project.important_files.slice(0, 5).map((file, index) => (
            <article key={file.file}><span>0{index + 1}</span><strong>{file.file}</strong><p>{file.reasons.slice(0, 2).join(' · ')}</p><i>{file.score} pts</i></article>
          ))}
        </div>
      </section>
    </div>
  );
}

function RoutesView({ project, selected, onSelect }: { project: RepoDNAProject; selected: RouteRecord | null; onSelect: (route: RouteRecord) => void }) {
  const flow = selected ? project.flows.find((candidate) => candidate.name === `${selected.method} ${selected.path}`) ?? null : null;
  return (
    <div className="view-stack routes-view">
      <section className="view-heading"><div><p className="eyebrow cyan-text">Request surface</p><h1>Routes & execution traces</h1><p>Select a route to follow the statically resolved call path.</p></div><span>{project.routes.length} routes</span></section>
      <div className="route-layout">
        <section className="panel route-list-panel">
          <div className="table-head"><span>Method</span><span>Path</span><span>Handler</span><span>Confidence</span></div>
          {project.routes.map((route) => (
            <button className={`route-row ${selected?.id === route.id ? 'is-selected' : ''}`} key={route.id} onClick={() => onSelect(route)} type="button">
              <span className={`method ${methodTone[route.method] ?? ''}`}>{route.method}</span>
              <code>{route.path}</code>
              <span>{route.handler.split('::').at(-1)}</span>
              <i>{Math.round(route.confidence * 100)}%</i>
            </button>
          ))}
        </section>
        <section className="panel trace-panel">
          <div className="panel-heading"><div><p className="eyebrow">Trace this</p><h2>{flow?.name ?? 'Select a route'}</h2></div>{flow && <span>{Math.round(flow.confidence * 100)}%</span>}</div>
          {flow ? <FlowTimeline flow={flow} /> : <p className="empty-copy">Choose a route to reveal its handler and resolved calls.</p>}
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
          <span className="flow-index">{String(index + 1).padStart(2, '0')}</span>
          <div><span>{node.type}</span><strong>{node.label}</strong><code>{node.file}:{node.line}</code></div>
          {index < flow.nodes.length - 1 && <i>↓</i>}
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
      ...project.imports.filter((edge) => edge.target && files.has(edge.target)).map((edge) => ({ source: edge.source, relation: 'imports file' })),
      ...project.calls.filter((edge) => edge.target && ids.has(edge.target)).map((edge) => ({ source: edge.source, relation: 'calls symbol' })),
    ];
  }, [project, query]);
  const localImports = project.imports.filter((edge) => edge.target);
  return (
    <div className="view-stack dependencies-view">
      <section className="view-heading"><div><p className="eyebrow cyan-text">Change impact</p><h1>What depends on this?</h1><p>Search a symbol to find structurally connected callers and importers.</p></div></section>
      <label className="impact-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try UserService, checkout, App…" /></label>
      {query && <section className="panel impact-results"><div className="panel-heading"><div><p className="eyebrow">Impact slice</p><h2>{query}</h2></div><span>{impacts.length} dependents</span></div>{impacts.length ? impacts.slice(0, 12).map((item, index) => <div className="impact-row" key={`${item.source}-${index}`}><code>{item.source}</code><span>{item.relation}</span></div>) : <p className="empty-copy">No statically resolved dependents found.</p>}</section>}
      <div className="dependency-columns">
        <section className="panel boundary-panel">
          <div className="panel-heading"><div><p className="eyebrow">Boundaries</p><h2>Data & external systems</h2></div></div>
          {[...project.databases, ...project.external_systems].map((boundary) => (
            <article className="boundary-row" key={`${boundary.type}-${boundary.name}`}><span>{boundary.type === 'database' ? 'DB' : 'EX'}</span><div><strong>{boundary.name}</strong><p>{boundary.evidence[0]?.file ?? 'Manifest evidence'}</p></div><i>{Math.round(boundary.confidence * 100)}%</i></article>
          ))}
        </section>
        <section className="panel import-panel">
          <div className="panel-heading"><div><p className="eyebrow">File graph</p><h2>Resolved imports</h2></div><span>{localImports.length}</span></div>
          <div className="import-list">{localImports.slice(0, 12).map((edge) => <div key={edge.id}><code>{edge.source}</code><span>→</span><code>{edge.target}</code></div>)}</div>
        </section>
      </div>
      {project.metrics.dependencyCycles.length > 0 && <section className="panel cycle-panel"><p className="eyebrow">Health signal</p><h2>Dependency cycles</h2>{project.metrics.dependencyCycles.map((cycle, index) => <code key={index}>{[...cycle, cycle[0]].join(' → ')}</code>)}</section>}
    </div>
  );
}

function FilesView({ project, search, onSelect }: { project: RepoDNAProject; search: string; onSelect: (file: FileRecord) => void }) {
  const filtered = useMemo(() => {
    const query = search.toLowerCase();
    return project.files.filter((file) => !query || file.path.toLowerCase().includes(query) || file.language.toLowerCase().includes(query));
  }, [project.files, search]);
  const symbolsByFile = useMemo(() => project.symbols.reduce<Record<string, number>>((counts, symbol) => {
    counts[symbol.file] = (counts[symbol.file] ?? 0) + (symbol.type === 'module' ? 0 : 1);
    return counts;
  }, {}), [project.symbols]);
  return (
    <div className="view-stack files-view">
      <section className="view-heading"><div><p className="eyebrow cyan-text">Repository index</p><h1>Files & symbols</h1><p>Every source record links back to analysis evidence.</p></div><span>{filtered.length} shown</span></section>
      <section className="panel file-table">
        <div className="file-row file-header"><span>File</span><span>Language</span><span>Lines</span><span>Symbols</span><span>Status</span></div>
        {filtered.slice(0, 250).map((file) => (
          <button className="file-row" key={file.id} onClick={() => onSelect(file)} type="button"><code>{file.path}</code><span>{file.language}</span><span>{file.lines}</span><span>{symbolsByFile[file.path] ?? 0}</span><i className={file.parsed || file.language === 'Configuration' ? 'status-ok' : 'status-warn'}>{file.error ? 'Skipped' : file.parsed ? 'Parsed' : 'Indexed'}</i></button>
        ))}
      </section>
    </div>
  );
}

function DetailPanel({ component, route, file, project, onTrace }: { component: ArchitectureComponent | null; route: RouteRecord | null; file: FileRecord | null; project: RepoDNAProject; onTrace: () => void }) {
  if (route) return <aside className="detail-panel"><p className="eyebrow">Selected route</p><div className="detail-icon route-icon">↳</div><h2>{route.method} {route.path}</h2><p className="muted">{route.framework} handler at {route.file}:{route.line}</p><dl><div><dt>Handler</dt><dd>{route.handler.split('::').at(-1)}</dd></div><div><dt>Confidence</dt><dd className="good">{Math.round(route.confidence * 100)}%</dd></div></dl><button className="trace-button" onClick={onTrace} type="button">View full trace <span>↗</span></button></aside>;
  if (file) {
    const symbols = project.symbols.filter((symbol) => symbol.file === file.path && symbol.type !== 'module');
    return <aside className="detail-panel"><p className="eyebrow">Selected file</p><div className="detail-icon file-icon">F</div><h2>{file.path.split('/').at(-1)}</h2><p className="muted detail-path">{file.path}</p><dl><div><dt>Language</dt><dd>{file.language}</dd></div><div><dt>Lines</dt><dd>{file.lines}</dd></div><div><dt>Symbols</dt><dd>{symbols.length}</dd></div><div><dt>Status</dt><dd className="good">{file.parsed ? 'Parsed' : 'Indexed'}</dd></div></dl><p className="eyebrow section-label">Symbols</p><ul className="evidence-list">{symbols.slice(0, 8).map((symbol) => <li key={symbol.id}>{symbol.type} · {symbol.name} · L{symbol.line}</li>)}</ul></aside>;
  }
  if (!component) return <aside className="detail-panel"><p className="eyebrow">Inspector</p><p className="muted">Select a component, route, or file to inspect its evidence.</p></aside>;
  return <aside className="detail-panel"><p className="eyebrow">Selected component</p><div className="detail-icon">{component.name.slice(0, 1)}</div><h2>{component.name}</h2><p className="muted">A structural region inferred from paths, symbols, framework patterns and dependency direction.</p><dl><div><dt>Type</dt><dd>{component.type}</dd></div><div><dt>Confidence</dt><dd className="good">{Math.round(component.confidence * 100)}%</dd></div><div><dt>Files</dt><dd>{component.files.length}</dd></div></dl><p className="eyebrow section-label">Evidence</p><ul className="evidence-list">{component.evidence.map((item) => <li key={item}>{item}</li>)}{component.files.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul><button className="trace-button" onClick={onTrace} type="button">Trace this component <span>↗</span></button></aside>;
}

function AnalyseDialog({ open, onClose, onImport }: { open: boolean; onClose: () => void; onImport: (project: RepoDNAProject) => void }) {
  const [githubUrl, setGithubUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  if (!open) return null;
  const command = `repodna analyse ${githubUrl.trim() || '<repository>'} -o .repodna/project.json`;
  async function importFile(file?: File) {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!matchesProject(parsed)) throw new Error('This is not a compatible RepoDNA project file.');
      onImport(parsed);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load this project file.');
    }
  }
  async function copyCommand() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="analyse-dialog" role="dialog" aria-modal="true" aria-labelledby="analyse-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="dialog-close" onClick={onClose} aria-label="Close" type="button">×</button>
        <p className="eyebrow cyan-text">New analysis</p><h2 id="analyse-title">Map a repository</h2><p>RepoDNA analyses source as text and never runs project code or install scripts.</p>
        <button className="import-drop" onClick={() => fileRef.current?.click()} type="button"><span>↑</span><strong>Open repodna.json</strong><small>Load a local analysis into this viewer</small></button>
        <input ref={fileRef} hidden type="file" accept="application/json,.json" onChange={(event) => void importFile(event.target.files?.[0])} />
        <div className="dialog-divider"><span>or analyse from the CLI</span></div>
        <label className="github-field"><span>GitHub URL or local path</span><input value={githubUrl} onChange={(event) => setGithubUrl(event.target.value)} placeholder="https://github.com/owner/repository" /></label>
        <div className="command-box"><code>{command}</code><button onClick={() => void copyCommand()} type="button">{copied ? 'Copied' : 'Copy'}</button></div>
        {error && <p className="dialog-error" role="alert">{error}</p>}
        <p className="privacy-note"><span>◆</span> Local-first: repository contents stay on your machine.</p>
      </section>
    </div>
  );
}

export function RepoWorkspace() {
  const [project, setProject] = useState<RepoDNAProject | null>(null);
  const [view, setView] = useState<View>('overview');
  const [search, setSearch] = useState('');
  const [selectedComponent, setSelectedComponent] = useState<ArchitectureComponent | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<RouteRecord | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    fetch('/demo-project.json')
      .then((response) => {
        if (!response.ok) throw new Error(`Demo artifact returned ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((value) => {
        if (!matchesProject(value)) throw new Error('The demo artifact has an incompatible schema.');
        setProject(value);
        setSelectedComponent(value.architecture.components.find((component) => component.type === 'api') ?? value.architecture.components[0] ?? null);
        setSelectedRoute(value.routes[0] ?? null);
      })
      .catch((reason: unknown) => setLoadError(reason instanceof Error ? reason.message : 'Could not load the demo project.'));
  }, []);

  function selectComponent(component: ArchitectureComponent) {
    setSelectedComponent(component); setSelectedRoute(null); setSelectedFile(null);
  }
  function selectRoute(route: RouteRecord) {
    setSelectedRoute(route); setSelectedComponent(null); setSelectedFile(null);
  }
  function selectFile(file: FileRecord) {
    setSelectedFile(file); setSelectedRoute(null); setSelectedComponent(null);
  }
  function importProject(nextProject: RepoDNAProject) {
    setProject(nextProject); setView('overview'); setSearch(''); setSelectedRoute(nextProject.routes[0] ?? null); setSelectedFile(null); setSelectedComponent(nextProject.architecture.components[0] ?? null);
  }

  if (loadError) return <main className="fatal-state"><span>!</span><h1>Could not open RepoDNA</h1><p>{loadError}</p></main>;
  if (!project) return <main className="empty-shell"><EmptyState /></main>;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={() => setView('overview')} aria-label="RepoDNA overview"><span className="brand-mark">R</span><span>RepoDNA</span><span className="version">LOCAL</span></a>
        <label className="global-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} onFocus={() => setView('files')} placeholder="Search files, symbols, routes…" /><kbd>⌘ K</kbd></label>
        <div className="repo-pill"><span className="status-dot" /> {project.repository.name}</div>
        <button className="analyse-button" onClick={() => setDialogOpen(true)} type="button">Analyse repository</button>
      </header>

      <aside className="sidebar">
        <p className="eyebrow">Workspace</p>
        {navigation.map((item, index) => <button className={`nav-item ${view === item.id ? 'active' : ''}`} key={item.id} onClick={() => setView(item.id)} type="button"><span className="nav-index">0{index + 1}</span>{item.label}</button>)}
        <div className="sidebar-divider" />
        <p className="eyebrow">Repository</p>
        <div className="repo-facts"><span><strong>{project.repository.sourceFileCount}</strong> source files</span><span><strong>{project.metrics.symbols}</strong> symbols</span><span><strong>{project.metrics.routes}</strong> routes</span></div>
        <div className="privacy-card"><span className="shield">◆</span><div><strong>Local by design</strong><p>Your source never leaves this machine.</p></div></div>
      </aside>

      <section className="workspace">
        {view === 'overview' && <Overview project={project} onOpenArchitecture={() => setView('architecture')} />}
        {view === 'architecture' && <div className="architecture-view"><section className="view-heading"><div><p className="eyebrow cyan-text">Progressive map</p><h1>Architecture</h1><p>Move, pan, zoom and select a component to inspect its evidence.</p></div><span>{project.architecture.components.length} components</span></section><ArchitectureGraph components={project.architecture.components} connections={project.architecture.connections} selectedId={selectedComponent?.id ?? null} onSelect={selectComponent} /></div>}
        {view === 'routes' && <RoutesView project={project} selected={selectedRoute} onSelect={selectRoute} />}
        {view === 'dependencies' && <DependenciesView project={project} />}
        {view === 'files' && <FilesView project={project} search={search} onSelect={selectFile} />}
      </section>

      <DetailPanel component={selectedComponent} route={selectedRoute} file={selectedFile} project={project} onTrace={() => setView('routes')} />
      <AnalyseDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onImport={importProject} />
    </main>
  );
}

