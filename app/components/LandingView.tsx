'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Handle, MarkerType, Position, ReactFlow, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import packageMetadata from '../../package.json';
import type { RepoDNAProjectV2 } from '../lib/analyzer/v2/types';
import type { BrowserCachedArtifact } from '../lib/export/browser-export-cache';
import { loadRepoDNAArtifact } from '../lib/schema/artifact-loader';
import { Dna, ExternalLink, FileCode, FileJson, Folder, Github, MessageCircle } from './icons';
import { ScannedRepositoryCounter } from './ScannedRepositoryCounter';

const SAMPLE_URL = 'https://github.com/karpathy/nanoGPT';
const samples = [
  ['karpathy/nanoGPT', 'Python · language model training'],
  ['tiangolo/full-stack-fastapi-template', 'Python & TypeScript · full-stack template'],
  ['usestrix/strix', 'Python & Go · security testing'],
] as const;

function PreviewNode({ data }: NodeProps<Node<{ label: React.ReactNode }>>) {
  return <>
    <Handle id="top-in" type="target" position={Position.Top} />
    <Handle id="bottom-in" type="target" position={Position.Bottom} />
    <Handle id="top-out" type="source" position={Position.Top} />
    <Handle id="bottom-out" type="source" position={Position.Bottom} />
    {data.label}
  </>;
}
const previewNodeTypes = { preview: PreviewNode };

/** A bounded projection of actual sample edges, not an invented architecture diagram. */
function previewGraph(project: RepoDNAProjectV2) {
  const byId = new Map(project.nodes.map((node) => [node.id, node]));
  const links = project.edges.filter((edge) => edge.target && byId.has(edge.target) &&
    byId.has(edge.source) && ['IMPORTS', 'DEPENDS_ON'].includes(edge.type));
  const degree = new Map<string, number>();
  for (const edge of links) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target!, (degree.get(edge.target!) ?? 0) + 1);
  }
  const hub = project.nodes.filter((node) => node.kind === 'module' || node.kind === 'file')
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id))[0];
  if (!hub) return { nodes: [], edges: [] };
  const neighbors = [...new Set(links.filter((edge) => edge.source === hub.id || edge.target === hub.id)
    .map((edge) => edge.source === hub.id ? edge.target! : edge.source))]
    .sort((a, b) => Number(byId.get(a)?.kind === 'dependency') - Number(byId.get(b)?.kind === 'dependency') || a.localeCompare(b))
    .slice(0, 6);
  const ids = new Set([hub.id, ...neighbors]);
  const nodes = [hub.id, ...neighbors].map((id, index) => {
    const node = byId.get(id)!;
    return {
      id,
      type: 'preview',
      position: index === 0 ? { x: 192, y: 150 } : { x: ((index - 1) % 3) * 192, y: index <= 3 ? 0 : 300 },
      data: { label: <><FileCode size={17} aria-hidden="true" /><span><small>{node.kind === 'dependency' ? 'Imported dependency' : node.language}</small><strong>{node.name}</strong></span></> },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      className: index === 0 ? 'preview-node preview-node-primary' : 'preview-node',
      style: { width: 164, height: 64 },
      draggable: false,
      selectable: false,
      focusable: false,
    };
  });
  const positions = new Map(nodes.map((node) => [node.id, node.position]));
  const edges = links.filter((edge) => ids.has(edge.source) && ids.has(edge.target!) &&
    (edge.source === hub.id || edge.target === hub.id)).slice(0, 6).map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target!,
    sourceHandle: positions.get(edge.source)!.y > positions.get(edge.target!)!.y ? 'top-out' : 'bottom-out',
    targetHandle: positions.get(edge.source)!.y > positions.get(edge.target!)!.y ? 'bottom-in' : 'top-in',
    label: edge.type === 'IMPORTS' ? 'imports' : 'depends on',
    type: 'default',
    markerEnd: { type: MarkerType.ArrowClosed, color: '#8295a6' },
    style: { stroke: '#8295a6', strokeWidth: 1.2 },
    labelStyle: { fill: '#a1afbb', fontSize: 11 },
    labelBgStyle: { fill: '#171d23' },
    focusable: false,
  }));
  return { nodes, edges };
}

function SamplePreview({ onOpen }: { onOpen: () => void }) {
  const [project, setProject] = useState<RepoDNAProjectV2 | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/samples/nanogpt.json', { signal: controller.signal });
        if (!response.ok) throw new Error('Sample unavailable');
        const artifact = loadRepoDNAArtifact(await response.json());
        if (!artifact.isV2) throw new Error('Unexpected sample version');
        if (!disposed) setProject(artifact.project as RepoDNAProjectV2);
      } catch {
        if (!disposed && !controller.signal.aborted) setFailed(true);
      }
    }
    void load();
    return () => { disposed = true; controller.abort(); };
  }, []);
  const graph = useMemo(() => project ? previewGraph(project) : { nodes: [], edges: [] }, [project]);
  const files = [...new Map(project?.nodes.filter((node) => node.kind === 'module' || node.kind === 'file')
    .map((node) => [node.path, node]) ?? []).values()]
    .sort((a, b) => Number(a.path.includes('/')) - Number(b.path.includes('/')) || a.path.localeCompare(b.path))
    .slice(0, 9) ?? [];
  const unresolved = project?.edges.filter((edge) => edge.target === null || ['unresolved', 'ambiguous'].includes(edge.status)).length;
  return (
    <section className="sample-preview" aria-label="Example repository snapshot">
      <header>
        <button type="button" onClick={onOpen}>Example snapshot: nanoGPT <ExternalLink size={14} aria-hidden="true" /></button>
        {project ? <span className="preview-warning">{unresolved} unresolved links</span> : null}
      </header>
      {project ? <>
        <div className="sample-preview-body">
          <div className="preview-files"><p>Files</p>{files.map((node) => <div key={node.id} title={node.path}><FileCode size={15} aria-hidden="true" /><span>{node.path}</span></div>)}</div>
          <div className="preview-canvas" aria-label="Selected import relationships from the nanoGPT snapshot">
            <ReactFlow nodeTypes={previewNodeTypes} nodes={graph.nodes} edges={graph.edges} fitView fitViewOptions={{ padding: 0.16 }}
              panOnDrag={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}
              nodesConnectable={false} elementsSelectable={false} nodesFocusable={false} edgesFocusable={false}
              preventScrolling={false} proOptions={{ hideAttribution: true }} />
          </div>
        </div>
        <footer>Selected imports, not the full graph · commit {project.repository.commitSha?.slice(0, 7) ?? 'not recorded'}<button type="button" onClick={onOpen}>Explore snapshot →</button></footer>
      </> : <div className="preview-loading" role="status">{failed ? 'Preview unavailable. You can still open a sample below.' : 'Loading the bundled repository snapshot…'}</div>}
    </section>
  );
}

export function LandingView({ onAnalyzeGitHub, onAnalyzeFolder, onAnalyzeZip, onLoadDemo, onOpenPrivatePicker,
  onOpenFeedback, session, recentArtifacts, onOpenRecent, onRemoveRecent, onClearRecent }: {
  onAnalyzeGitHub: (url: string) => void;
  onAnalyzeFolder: (files: FileList) => void;
  onAnalyzeZip: (file: File) => void;
  onLoadDemo: () => void;
  onOpenPrivatePicker: () => void;
  onOpenFeedback: () => void;
  session: { user?: { name?: string; image?: string } } | null;
  recentArtifacts: BrowserCachedArtifact[];
  onOpenRecent: (entry: BrowserCachedArtifact) => void;
  onRemoveRecent: (entry: BrowserCachedArtifact) => void;
  onClearRecent: () => void;
}) {
  const [url, setUrl] = useState('');
  const urlInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  return (
    <main className="landing-shell clean-landing">
      <header className="landing-topbar">
        <Link className="brand" href="/" aria-label="RepoDNA"><span className="brand-mark"><Dna size={23} aria-hidden="true" /></span><span className="brand-title">RepoDNA</span><span className="version">v{packageMetadata.version} BETA</span></Link>
        <nav className="landing-nav-center" aria-label="Product links">
          <button type="button" onClick={onLoadDemo}>Try Demo Project</button>
          <button type="button" onClick={onOpenFeedback}><MessageCircle size={17} aria-hidden="true" />Feedback</button>
          <a href="https://github.com/AnasBabari/RepoDNA" target="_blank" rel="noreferrer"><Github size={17} aria-hidden="true" />GitHub</a>
        </nav>
        <div className="landing-auth-right">{session?.user ? <button className="chip-button" type="button" onClick={onOpenPrivatePicker}>{session.user.name || 'Your account'} · Repositories</button> : <Link href="/api/auth/signin?callbackUrl=/" className="chip-button">GitHub Sign In (Beta)</Link>}</div>
      </header>
      <div className="landing-content">
        <section className="landing-split" aria-labelledby="landing-title">
          <div className="landing-intro">
            <h1 id="landing-title">Understand<br />the shape of<br /><span>any codebase.</span></h1>
            <p className="landing-description">Explore architecture, dependencies and call paths without running repository code.</p>
            <div className="landing-source-actions" role="group" aria-label="Repository sources">
              <button type="button" className="is-current" onClick={() => urlInputRef.current?.focus()}><Github size={18} aria-hidden="true" />GitHub repository</button>
              <button type="button" onClick={() => folderInputRef.current?.click()}><Folder size={18} aria-hidden="true" />Local folder</button>
              <button type="button" onClick={() => zipInputRef.current?.click()}><FileJson size={18} aria-hidden="true" />ZIP or JSON</button>
            </div>
            <form className="landing-repository-form" onSubmit={(event) => { event.preventDefault(); if (url.trim()) onAnalyzeGitHub(url.trim()); }} aria-label="Analyze public GitHub repository">
              <Github size={21} aria-hidden="true" />
              <input ref={urlInputRef} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/owner/repository" aria-label="GitHub repository URL" autoComplete="off" spellCheck={false} required />
              <button className="analyse-button" type="submit" aria-label="Analyze repository">Analyze repository <span aria-hidden="true">→</span></button>
            </form>
            <p className="landing-support">Supports Python, JavaScript, TypeScript; Go (experimental).</p>
          </div>
          <SamplePreview onOpen={() => onAnalyzeGitHub(SAMPLE_URL)} />
        </section>
        <div className="landing-resource-grid">
          <section aria-labelledby="import-title"><h2 id="import-title">Import a repository</h2><p>Analyze a public repository, or upload your own code.</p>
            <button className="landing-resource-row" type="button" onClick={() => urlInputRef.current?.focus()}><Github size={27} aria-hidden="true" /><span><strong>GitHub repository</strong><small>Paste a public GitHub repository URL.</small></span><span aria-hidden="true">›</span></button>
            <button className="landing-resource-row" type="button" onClick={() => folderInputRef.current?.click()}><Folder size={27} aria-hidden="true" /><span><strong>Local folder</strong><small>Analyze a project on your computer, inside this browser.</small></span><span aria-hidden="true">›</span></button>
            <button className="landing-resource-row" type="button" onClick={() => zipInputRef.current?.click()}><FileJson size={27} aria-hidden="true" /><span><strong>ZIP or JSON file</strong><small>Open a repository archive or exported RepoDNA analysis.</small></span><span aria-hidden="true">›</span></button>
            <button className="landing-private-link" type="button" onClick={onOpenPrivatePicker}>Connect a private repository <span>GitHub access required →</span></button>
          </section>
          <section aria-labelledby="sample-title"><h2 id="sample-title">Try a sample repository</h2><p>Explore bundled snapshots. These are not fresh scans.</p>
            {samples.map(([name, description]) => <button className="landing-resource-row" key={name} type="button" onClick={() => onAnalyzeGitHub(`https://github.com/${name}`)}><FileCode size={19} aria-hidden="true" /><span><strong>{name}</strong><small>{description}</small></span><span aria-hidden="true">›</span></button>)}
            <button className="landing-resource-row" type="button" onClick={onLoadDemo}><FileCode size={19} aria-hidden="true" /><span><strong>mixed-basic (demo)</strong><small>Small demonstration repository.</small></span><span aria-hidden="true">›</span></button>
          </section>
        </div>
        <input ref={folderInputRef} hidden type="file"
          // @ts-expect-error webkitdirectory is standard for folder picker
          webkitdirectory="true" directory="true" onChange={(event) => {
            // FileList is live: clearing this input before async ingestion reads
            // it silently turns a selected directory into an empty analysis.
            if (event.target.files?.length) onAnalyzeFolder(event.target.files);
          }} />
        <input ref={zipInputRef} hidden type="file" accept=".zip,application/zip,.json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) onAnalyzeZip(file); event.target.value = ''; }} />
        {recentArtifacts.length > 0 ? <section className="recent-analyses" aria-labelledby="recent-analyses-title"><div className="recent-analyses-heading"><h2 id="recent-analyses-title">Recent on this device</h2><button className="chip-button" type="button" onClick={onClearRecent}>Clear all</button></div><div className="recent-analyses-grid">{recentArtifacts.map((entry) => <article className="recent-analysis-card" key={entry.key}><div><h3>{entry.project.repository.name}</h3><p>{entry.project.nodes.length} nodes · {entry.project.edges.length} relationships · expires {new Date(entry.expiresAt).toLocaleDateString()}</p></div><div className="recent-analysis-actions"><button className="chip-button" type="button" onClick={() => onOpenRecent(entry)}>Open</button><button className="chip-button danger" type="button" onClick={() => onRemoveRecent(entry)}>Remove</button></div></article>)}</div></section> : null}
        <details className="landing-data-note"><summary>How your code and findings are handled</summary><p>Repository code is read statically, not executed. Local folders and ZIP files are analyzed in your browser; public GitHub analysis may run on the server. Private access uses the configured GitHub App, with OAuth as a fallback. With your consent, derived findings can be retained in IndexedDB; layout preferences use localStorage. Downloaded exports remain on your device.</p></details>
        <footer className="landing-footer"><p>Static analysis has limits. Unresolved relationships are reported, not guessed.</p><ScannedRepositoryCounter /></footer>
      </div>
    </main>
  );
}
