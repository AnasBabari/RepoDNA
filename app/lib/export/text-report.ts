import type { RepoDNAProject } from '../types';
import type { RepoDNAProjectV2, GraphNode, GraphEdge } from '../analyzer/v2/types';

/**
 * Deterministic plain-text architecture report.
 * Accepts either a v1.1 artifact or a canonical v2 graph artifact and renders
 * every section without AI involvement. Very large sections are summarized
 * with bounded ranked lists followed by totals; the JSON export always
 * contains the complete machine-readable data.
 */

const MAX_LIST = 25;
const MAX_ITEMS_NOTE = 'Full machine-readable data is available in the JSON export (repodna.json).';

type AnyProject = RepoDNAProject | RepoDNAProjectV2;

function isV2(project: AnyProject): project is RepoDNAProjectV2 {
  return (project as RepoDNAProjectV2).schemaVersion === '2.0.0';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Deterministic timestamp rendering: ISO-8601 UTC. */
function fmtDate(iso: string | undefined | null): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

function line(ch: string, width = 72): string {
  return ch.repeat(width);
}

function heading(num: number, title: string): string[] {
  return ['', `${num}. ${title}`, line('-')];
}

interface ListOpts {
  total: number;
  shown: number;
}

function truncationFooter(opts: ListOpts): string {
  return `  ... showing ${opts.shown} of ${opts.total} entries. ${MAX_ITEMS_NOTE}`;
}

function takeSorted<T>(items: Iterable<T>, key: (t: T) => string, limit = MAX_LIST): { rows: T[]; total: number } {
  const all = Array.from(items);
  const rows = [...all].sort((a, b) => key(a).localeCompare(key(b))).slice(0, limit);
  return { rows, total: all.length };
}

export interface TextReportMeta {
  /** Overrides the reported analysis timestamp for reproducible tests. */
  generatedAt?: string;
}

export function generateTextReport(project: AnyProject, meta?: TextReportMeta): string {
  const out: string[] = [];
  const v2 = isV2(project);
  const v1 = v2 ? null : (project as RepoDNAProject);
  const repo = project.repository;

  const languages: Record<string, number> = repo.languages ?? {};
  const fingerprint = repo.fingerprint;
  const diagnostics = project.diagnostics ?? [];

  // ---- v1 / v2 normalized views -------------------------------------------
  const files = ('files' in project ? project.files : []) ?? [];
  const symbols = ('symbols' in project ? project.symbols : []) ?? [];
  const imports = ('imports' in project ? project.imports : []) ?? [];
  const calls = ('calls' in project ? project.calls : []) ?? [];
  const routes = ('routes' in project ? project.routes : []) ?? [];
  const entrypoints = ('entrypoints' in project ? project.entrypoints ?? [] : []) ?? [];
  const flows = ('flows' in project ? project.flows ?? [] : []) ?? [];
  const components = project.architecture?.components ?? [];
  const importantFiles = v1?.importantFiles ?? [];
  const metrics = v1?.metrics;
  const v1Metadata = v1?.metadata;

  const nodes: GraphNode[] = v2 ? project.nodes : [];
  const edges: GraphEdge[] = v2 ? project.edges : [];
  const inventory = v2 ? project.inventory : null;
  const coverage = v2 ? project.coverage : null;
  const communities = v2 ? project.communities : [];
  const dependencyCycles = v2 ? project.dependencyCycles : metrics?.dependencyCycles ?? [];
  const centrality = v2 ? project.centrality : null;
  const unresolved = v2 ? project.unresolved : [];
  const timings = v2 ? project.timings : null;
  const parsers = v2 ? project.parsers : null;
  const security = v2 ? project.security : null;
  const completeness = v2 ? project.completeness : null;

  // ---- Header --------------------------------------------------------------
  out.push(line('='));
  out.push('RepoDNA Architecture Report');
  out.push(line('='));

  // 1. Repository identity and commit
  out.push(...heading(1, 'Repository identity'));
  out.push(`Name:            ${repo.name}`);
  out.push(`Source:          ${repo.source}`);
  if (v2) {
    const repoV2 = repo as RepoDNAProjectV2['repository'];
    out.push(`Analyzed commit: ${repoV2.commitSha ?? '(not pinned)'}`);
    out.push(`Analyzed ref:    ${repoV2.analyzedRef ?? '(not recorded)'}`);
  }
  // 2. Analysis timestamp and versions
  out.push(...heading(2, 'Analysis metadata'));
  out.push(`Generated at:    ${fmtDate(meta?.generatedAt ?? project.generatedAt)}`);
  out.push(`Schema version:  ${project.schemaVersion}`);
  const analyzerVersion =
    (v2 ? project.metadata?.analyzerVersion : v1Metadata?.analyzerVersion) || 'unknown';
  out.push(`Analyzer version: ${analyzerVersion}`);
  if (parsers) {
    out.push(`Parser mode:     ${parsers.mode}`);
    for (const name of Object.keys(parsers.versions).sort()) {
      out.push(`Parser ${name}: ${parsers.versions[name]}`);
    }
  }

  // 3. Safety statement
  out.push(...heading(3, 'Safety statement'));
  const executedCode: boolean | null = security
    ? security.executedRepositoryCode
    : typeof v1Metadata?.executedRepositoryCode === 'boolean'
      ? v1Metadata.executedRepositoryCode
      : null;
  out.push(
    executedCode === false
      ? 'Zero execution guarantee: repository source code was treated strictly as data.'
      : 'WARNING: execution flag could not be verified for this artifact.'
  );
  out.push('No analyzed source was installed, imported, evaluated, built, or run.');
  if (security) {
    out.push('Applied limits:');
    const lim = security.limits;
    const limitKeys = Object.keys(lim).sort();
    for (const k of limitKeys) {
      const v = (lim as Record<string, number | undefined>)[k];
      out.push(`  ${k}: ${v ?? 'n/a'}`);
    }
    if (security.truncated.length > 0) {
      out.push(`Truncation signals: ${[...security.truncated].sort().join(', ')}`);
    }
  } else if (v1Metadata?.limits) {
    out.push('Applied limits:');
    out.push(`  maxFiles: ${v1Metadata.limits.maxFiles}`);
    out.push(`  maxFileBytes: ${v1Metadata.limits.maxFileBytes}`);
    if (v1Metadata.limits.maxArchiveBytes) out.push(`  maxArchiveBytes: ${v1Metadata.limits.maxArchiveBytes}`);
  }

  // 4. Inventory
  out.push(...heading(4, 'Repository inventory'));
  if (inventory) {
    out.push(`Total archive entries:     ${inventory.totalFileCount}`);
    out.push(`Total bytes (declared):    ${inventory.totalBytes}`);
    out.push(`First-party source files:  ${inventory.firstPartySourceFileCount}`);
    out.push(`First-party lines of code: ${inventory.firstPartyLoc}`);
    out.push(`Parse candidates:          ${inventory.candidateFileCount}`);
    out.push(`Parsed completely:         ${inventory.parsedFileCount}`);
    out.push(`Parsed partially:          ${inventory.partiallyParsedFileCount}`);
    out.push(`Failed to parse:           ${inventory.failedFileCount}`);
    out.push(`Unsupported source:        ${inventory.unsupportedSourceFileCount}`);
    out.push(`Ignored (vendor/lockfile): ${inventory.ignoredFileCount}`);
    out.push(`Generated artifacts:       ${inventory.generatedFileCount}`);
    out.push(`Packages/workspaces:       ${inventory.packageCount}`);
    out.push(`Declared dependencies:     ${inventory.declaredDependencyCount}`);
    const reasons = Object.keys(inventory.skippedByReason).sort();
    if (reasons.length > 0) {
      out.push('Skipped by reason:');
      for (const r of reasons) out.push(`  ${r}: ${inventory.skippedByReason[r]}`);
    }
    const langs = Object.keys(inventory.languageCoverage).sort();
    if (langs.length > 0) {
      out.push('Language coverage (candidate files):');
      for (const l of langs) out.push(`  ${l}: ${inventory.languageCoverage[l]}`);
    }
  } else {
    out.push(`Repository files:   ${v1?.repository.fileCount ?? 'n/a'}`);
    out.push(`Source files:       ${v1?.repository.sourceFileCount ?? 'n/a'}`);
    out.push(`Parsed files:       ${v1?.repository.parsedFileCount ?? 'n/a'}`);
    out.push(`Lines of code:      ${(v1?.repository.lines ?? 0).toLocaleString('en-US')}`);
  }

  // 5. Size classification
  out.push(...heading(5, 'Size classification'));
  const sizeFiles = inventory ? inventory.firstPartySourceFileCount : v1?.repository.sourceFileCount ?? 0;
  const loc = inventory ? inventory.firstPartyLoc : v1?.repository.lines ?? 0;
  let size: string;
  if (sizeFiles >= 1000 || loc >= 250000) size = 'Very large';
  else if (sizeFiles >= 250 || loc >= 50000) size = 'Large';
  else if (sizeFiles >= 50 || loc >= 10000) size = 'Medium';
  else size = 'Small';
  out.push(`${size} (${sizeFiles} first-party source files, ${loc.toLocaleString('en-US')} LOC)`);

  // 6. Coverage and limitations
  out.push(...heading(6, 'Scan coverage and limitations'));
  if (coverage && completeness) {
    out.push(`Coverage: ${coverage.percentage}%`);
    out.push(`Completeness: ${completeness.status}`);
    for (const reason of completeness.reasons) out.push(`  - ${reason}`);
    if (coverage.truncationReasons.length > 0) {
      out.push('Truncation reasons:');
      for (const t of coverage.truncationReasons) out.push(`  - ${t}`);
    }
  } else {
    const rate = metrics ? metrics.parseSuccessRate : null;
    out.push(`Parse success rate: ${rate === null ? 'unknown' : `${rate}%`}`);
  }
  if (!v2) {
    out.push('Note: this artifact predates canonical graph coverage reporting (schema 1.1.0).');
  }

  // 7. Languages
  out.push(...heading(7, 'Languages'));
  const langKeys = Object.keys(languages).sort((a, b) => (languages[b] ?? 0) - (languages[a] ?? 0));
  for (const l of langKeys) out.push(`  ${l}: ${languages[l]}`);

  // 8. Packages/workspaces
  out.push(...heading(8, 'Packages and workspaces'));
  if (inventory && inventory.packageCount > 0) {
    const pkgNodes = nodes.filter((n) => n.kind === 'package' || n.kind === 'workspace');
    const { rows, total } = takeSorted(pkgNodes, (n) => n.path);
    for (const p of rows) out.push(`  ${p.qualifiedName} (${p.path})`);
    if (total > rows.length) out.push(truncationFooter({ total, shown: rows.length }));
  } else if (inventory) {
    out.push('  No package/workspace manifests detected.');
  } else {
    out.push(`  Local dependencies (v1 metric): ${metrics?.localDependencies ?? 'n/a'}`);
  }

  // 9. Frameworks and infrastructure
  out.push(...heading(9, 'Frameworks and infrastructure'));
  for (const f of [...fingerprint.frameworks].sort()) out.push(`  Framework: ${f}`);
  for (const f of [...fingerprint.infrastructure].sort()) out.push(`  Infrastructure: ${f}`);
  for (const f of [...fingerprint.buildTools].sort()) out.push(`  Build tool: ${f}`);
  for (const f of [...fingerprint.testing].sort()) out.push(`  Testing: ${f}`);
  for (const t of [...(v1?.technologies ?? [])].sort()) out.push(`  Technology: ${t}`);

  // 10. Declared dependencies
  out.push(...heading(10, 'Declared dependencies'));
  const depNodes = nodes.filter((n) => n.kind === 'dependency');
  if (depNodes.length > 0) {
    const { rows, total } = takeSorted(depNodes, (n) => n.qualifiedName);
    for (const d of rows) out.push(`  ${d.qualifiedName}`);
    if (total > rows.length) out.push(truncationFooter({ total, shown: rows.length }));
  } else {
    out.push(`  External dependencies (v1 metric): ${metrics?.externalDependencies ?? 'n/a'}`);
  }

  // 11. Architecture areas
  out.push(...heading(11, 'Architecture areas'));
  const comps = [...components].sort((a, b) => a.name.localeCompare(b.name));
  for (const c of comps.slice(0, MAX_LIST)) {
    out.push(`  ${c.name} [${c.type}] confidence=${Math.round(c.confidence * 100)}% files=${c.files.length}`);
  }
  if (comps.length > MAX_LIST) out.push(truncationFooter({ total: comps.length, shown: MAX_LIST }));

  // 12. Entrypoints
  out.push(...heading(12, 'Entrypoints'));
  const eps = [...entrypoints].sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  for (const e of eps.slice(0, MAX_LIST)) out.push(`  ${e.file} (${e.kind}, score=${e.score})`);
  if (eps.length > MAX_LIST) out.push(truncationFooter({ total: eps.length, shown: MAX_LIST }));

  // 13. Routes and handlers
  out.push(...heading(13, 'Routes and handlers'));
  const rs = [...routes].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  for (const r of rs.slice(0, MAX_LIST)) out.push(`  ${r.method} ${r.path} -> ${r.handler} (${r.file}:${r.line})`);
  if (rs.length > MAX_LIST) out.push(truncationFooter({ total: rs.length, shown: MAX_LIST }));

  // 14. Execution paths
  out.push(...heading(14, 'Execution paths'));
  const fs2 = [...flows].sort((a, b) => a.name.localeCompare(b.name));
  for (const f of fs2.slice(0, MAX_LIST)) {
    const chain = f.nodes.map((n) => n.label).join(' -> ');
    out.push(`  ${f.name} (confidence=${Math.round(f.confidence * 100)}%): ${chain}`);
  }
  if (fs2.length > MAX_LIST) out.push(truncationFooter({ total: fs2.length, shown: MAX_LIST }));

  // 15. Modules
  out.push(...heading(15, 'Modules'));
  const importsByModule = new Map<string, number>();
  for (const imp of imports) importsByModule.set(imp.source, (importsByModule.get(imp.source) ?? 0) + 1);
  const callsByFile = new Map<string, number>();
  for (const c of calls) callsByFile.set(c.file, (callsByFile.get(c.file) ?? 0) + 1);
  if (nodes.length > 0) {
    const modules = nodes.filter((n) => n.kind === 'module' || n.kind === 'file');
    const { rows, total } = takeSorted(modules, (m) => m.path);
    for (const m of rows) out.push(`  ${m.path} (${m.language})`);
    if (total > rows.length) out.push(truncationFooter({ total, shown: rows.length }));
  } else {
    const parsed = files.filter((f) => f.parsed);
    const sorted = [...parsed].sort(
      (a, b) => b.lines - a.lines || a.path.localeCompare(b.path)
    );
    for (const f of sorted.slice(0, MAX_LIST)) {
      const imps = importsByModule.get(f.path) ?? 0;
      const cls = callsByFile.get(f.path) ?? 0;
      out.push(`  ${f.path} (${f.language}, ${f.lines} lines${imps ? `, ${imps} imports` : ''}${cls ? `, ${cls} calls` : ''})`);
    }
    if (sorted.length > MAX_LIST) out.push(truncationFooter({ total: sorted.length, shown: MAX_LIST }));
  }

  // 16. Classes, interfaces, methods, functions, attributes
  out.push(...heading(16, 'Symbols'));
  const byType = new Map<string, typeof symbols>();
  for (const s of symbols) {
    const arr = byType.get(s.type) ?? [];
    arr.push(s);
    byType.set(s.type, arr);
  }
  const typesOrder = ['class', 'interface', 'method', 'function', 'attribute', 'variable', 'component'].filter((t) =>
    byType.has(t)
  );
  for (const other of [...byType.keys()].sort().filter((t) => !typesOrder.includes(t))) typesOrder.push(other);
  for (const t of typesOrder) {
    const list = [...(byType.get(t) ?? [])].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name));
    out.push(`  ${t} (${list.length}):`);
    for (const s of list.slice(0, MAX_LIST)) {
      out.push(`    ${s.parent ? `${s.parent}.` : ''}${s.name} — ${s.file}:${s.line}${s.exported ? ' [exported]' : ''}`);
    }
    if (list.length > MAX_LIST) out.push(truncationFooter({ total: list.length, shown: MAX_LIST }));
  }
  if (nodes.length > 0 && symbols.length === 0) {
    const kinds = new Map<string, GraphNode[]>();
    for (const n of nodes) {
      if (['class', 'interface', 'method', 'function', 'attribute'].includes(n.kind)) {
        const arr = kinds.get(n.kind) ?? [];
        arr.push(n);
        kinds.set(n.kind, arr);
      }
    }
    for (const kind of [...kinds.keys()].sort()) {
      const list = [...(kinds.get(kind) ?? [])].sort((a, b) => a.path.localeCompare(b.path) || a.range.startLine - b.range.startLine);
      out.push(`  ${kind} (${list.length}):`);
      for (const n of list.slice(0, MAX_LIST)) out.push(`    ${n.qualifiedName} — ${n.path}:${n.range.startLine}`);
      if (list.length > MAX_LIST) out.push(truncationFooter({ total: list.length, shown: MAX_LIST }));
    }
  }

  // 17. Data models and tables
  out.push(...heading(17, 'Data models and tables'));
  const dataNodes = nodes.filter((n) => n.kind === 'data_model' || n.kind === 'table');
  const dbBoundaries = ('databases' in project ? project.databases : []) ?? [];
  if (dataNodes.length > 0) {
    const { rows, total } = takeSorted(dataNodes, (n) => n.qualifiedName);
    for (const d of rows) out.push(`  ${d.qualifiedName} (${d.kind}) — ${d.path}:${d.range.startLine}`);
    if (total > rows.length) out.push(truncationFooter({ total, shown: rows.length }));
  } else if (dbBoundaries.length > 0) {
    for (const db of [...dbBoundaries].sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_LIST)) {
      out.push(`  ${db.name} [${db.type}] confidence=${Math.round(db.confidence * 100)}%`);
    }
  } else {
    out.push('  No data models or database boundaries detected.');
  }

  // 18. Reads/writes
  out.push(...heading(18, 'Data reads and writes'));
  const rwEdges = edges.filter((e) => e.type === 'READS' || e.type === 'WRITES');
  if (rwEdges.length > 0) {
    const sorted = [...rwEdges].sort((a, b) => a.id.localeCompare(b.id));
    for (const e of sorted.slice(0, MAX_LIST)) {
      out.push(`  ${e.source} -${e.type}-> ${e.target ?? '?'} (${e.evidence.file}:${e.evidence.range.startLine}, confidence=${e.confidence})`);
    }
    if (sorted.length > MAX_LIST) out.push(truncationFooter({ total: sorted.length, shown: MAX_LIST }));
  } else {
    out.push('  No explicit read/write relationships were extracted.');
  }

  // 19. External systems
  out.push(...heading(19, 'External systems'));
  const extNodes = nodes.filter((n) => n.kind === 'external_system');
  const extBoundaries = ('externalSystems' in project ? project.externalSystems ?? project.external_systems : project.external_systems) ?? [];
  if (extNodes.length > 0) {
    const { rows, total } = takeSorted(extNodes, (n) => n.qualifiedName);
    for (const x of rows) out.push(`  ${x.qualifiedName}`);
    if (total > rows.length) out.push(truncationFooter({ total, shown: rows.length }));
  } else if (extBoundaries.length > 0) {
    for (const x of [...extBoundaries].sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_LIST)) {
      out.push(`  ${x.name} [${x.type}] confidence=${Math.round(x.confidence * 100)}%`);
    }
  } else {
    out.push('  None detected.');
  }

  // 20. Dependency communities
  out.push(...heading(20, 'Dependency communities'));
  if (communities.length > 0) {
    const sorted = [...communities].sort((a, b) => a.id.localeCompare(b.id));
    for (const c of sorted.slice(0, MAX_LIST)) {
      out.push(`  ${c.label} cohesion=${Math.round(c.cohesion * 100)}% members=${c.members.length}`);
    }
    if (sorted.length > MAX_LIST) out.push(truncationFooter({ total: sorted.length, shown: MAX_LIST }));
  } else {
    out.push('  Community detection not available for this artifact version.');
  }

  // 21. Cycles
  out.push(...heading(21, 'Dependency cycles'));
  if (dependencyCycles.length > 0) {
    const sorted = [...dependencyCycles].map((c) => [...c].sort()).sort((a, b) => a.join('|').localeCompare(b.join('|')));
    for (const c of sorted.slice(0, MAX_LIST)) out.push(`  ${c.join(' -> ')}`);
    if (sorted.length > MAX_LIST) out.push(truncationFooter({ total: sorted.length, shown: MAX_LIST }));
  } else {
    out.push('  No dependency cycles detected.');
  }

  // 22. Central/high-coupling nodes
  out.push(...heading(22, 'Central and high-coupling nodes'));
  if (centrality) {
    for (const m of centrality.mostConnected.slice(0, MAX_LIST)) {
      const node = nodes.find((n) => n.id === m.nodeId);
      out.push(`  ${node ? node.path + ' :: ' + node.qualifiedName : m.nodeId} in=${m.inDegree} out=${m.outDegree}`);
    }
    for (const g of centrality.godNodes.slice(0, 10)) out.push(`  GOD NODE: ${g.nodeId} — ${g.reason}`);
  } else {
    const mc = metrics?.mostConnectedFiles ?? [];
    for (const m of mc.slice(0, MAX_LIST)) out.push(`  ${m.file} connections=${m.connections}`);
    const hc = metrics?.highCouplingFiles ?? [];
    for (const h of hc.slice(0, MAX_LIST)) out.push(`  High coupling: ${h.file} connections=${h.connections}`);
    if (mc.length === 0 && hc.length === 0) out.push('  Not available.');
  }

  // 23. Blast-radius findings
  out.push(...heading(23, 'Blast radius findings'));
  if (centrality && centrality.highCoupling.length > 0) {
    for (const h of centrality.highCoupling.slice(0, MAX_LIST)) {
      const node = nodes.find((n) => n.id === h.nodeId);
      out.push(`  ${node ? node.path + ' :: ' + node.qualifiedName : h.nodeId}: ${h.connections} dependents — treat changes as high risk`);
    }
  } else {
    const hc = metrics?.highCouplingFiles ?? [];
    for (const h of hc.slice(0, MAX_LIST)) out.push(`  ${h.file}: ${h.connections} connections — treat changes as high risk`);
    if (hc.length === 0 && importantFiles.length === 0) out.push('  No high-coupling findings available.');
  }
  if (importantFiles.length > 0) {
    const ranked = [...importantFiles].sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
    out.push('  Highest-impact files by importance score:');
    for (const f of ranked.slice(0, 10)) out.push(`    ${f.file} (score=${Math.round(f.score * 100)}) ${f.reasons.join('; ')}`);
  }

  // 24. Unresolved and ambiguous relationships
  out.push(...heading(24, 'Unresolved and ambiguous relationships'));
  const ambEdges = edges.filter((e) => e.status === 'ambiguous' || e.status === 'unresolved');
  const unresolvedList = unresolved.length > 0 ? unresolved : ambEdges.map((e) => ({ edgeId: e.id, reason: e.explanation, candidates: e.alternativeCandidates ?? [] }));
  if (unresolvedList.length > 0) {
    const sorted = [...unresolvedList].sort((a, b) => a.edgeId.localeCompare(b.edgeId));
    for (const u of sorted.slice(0, MAX_LIST)) {
      const edge = edges.find((e) => e.id === u.edgeId);
      const expr = edge?.unresolvedExpression ? ` expression="${edge.unresolvedExpression}"` : '';
      out.push(`  ${u.edgeId}: ${u.reason}${expr}`);
      for (const c of u.candidates.slice(0, 5)) out.push(`    candidate: ${c}`);
    }
    if (sorted.length > MAX_LIST) out.push(truncationFooter({ total: sorted.length, shown: MAX_LIST }));
  } else if (v2) {
    out.push('  All extracted relationships resolved.');
  } else {
    out.push('  Resolution detail not available for this artifact version.');
  }

  // 25. Unsupported, skipped, partial, failed files
  out.push(...heading(25, 'Unsupported, skipped, partial, and failed files'));
  const partialFiles = files.filter((f) => f.parsed && f.error);
  const failedFiles = files.filter((f) => !f.parsed && f.error);
  const unparsed = files.filter((f) => !f.parsed && !f.error);
  if (partialFiles.length > 0) {
    out.push(`Partial parses (${partialFiles.length}):`);
    for (const f of partialFiles.slice(0, MAX_LIST)) out.push(`  ${f.path}: ${f.error}`);
    if (partialFiles.length > MAX_LIST) out.push(truncationFooter({ total: partialFiles.length, shown: MAX_LIST }));
  }
  if (failedFiles.length > 0) {
    out.push(`Failed parses (${failedFiles.length}):`);
    for (const f of failedFiles.slice(0, MAX_LIST)) out.push(`  ${f.path}: ${f.error}`);
    if (failedFiles.length > MAX_LIST) out.push(truncationFooter({ total: failedFiles.length, shown: MAX_LIST }));
  }
  if (inventory) {
    out.push(`Unsupported source files: ${inventory.unsupportedSourceFileCount}`);
    out.push(`Ignored files: ${inventory.ignoredFileCount}`);
    out.push(`Generated files: ${inventory.generatedFileCount}`);
    const skipTotal = Object.values(inventory.skippedByReason).reduce((a, b) => a + b, 0);
    if (skipTotal > 0) {
      out.push(`Skipped entries: ${skipTotal}`);
      for (const r of Object.keys(inventory.skippedByReason).sort()) out.push(`  ${r}: ${inventory.skippedByReason[r]}`);
    }
  }
  if (partialFiles.length === 0 && failedFiles.length === 0) {
    out.push(`No partial or failed parses among ${files.length} candidate file records.`);
  }
  if (unparsed.length > 0) {
    out.push(`Candidate files without parse records: ${unparsed.length}`);
    for (const f of unparsed.slice(0, MAX_LIST)) out.push(`  ${f.path}`);
    if (unparsed.length > MAX_LIST) out.push(truncationFooter({ total: unparsed.length, shown: MAX_LIST }));
  }

  // 26. Stage timings and limits
  out.push(...heading(26, 'Stage timings and limits'));
  if (timings) {
    const stages = Object.keys(timings.stages).sort();
    for (const s of stages) out.push(`  ${s}: ${timings.stages[s]}ms`);
    if (typeof timings.totalMs === 'number') out.push(`  total: ${timings.totalMs}ms`);
  } else {
    out.push('  Stage timings not available for this artifact version.');
  }
  if (diagnostics.length > 0) {
    const sortedDiag = [...diagnostics].sort((a, b) => a.code.localeCompare(b.code) || (a.file ?? '').localeCompare(b.file ?? ''));
    out.push(`Diagnostics (${diagnostics.length}):`);
    for (const d of sortedDiag.slice(0, MAX_LIST)) {
      out.push(`  [${d.severity}] ${d.code}${d.file ? ` @ ${d.file}` : ''}: ${d.message}`);
    }
    if (sortedDiag.length > MAX_LIST) out.push(truncationFooter({ total: sortedDiag.length, shown: MAX_LIST }));
  }

  out.push('');
  out.push(line('='));
  out.push(`End of report — schema ${project.schemaVersion}, generated by RepoDNA.`);
  out.push(MAX_ITEMS_NOTE);
  out.push(line('='));

  return out.join('\n') + '\n';
}
