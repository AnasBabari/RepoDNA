import { validateAnyArtifact } from './safe-validator';
import type { RepoDNAProject } from '../types';
import type { GraphEdge, GraphNode, GraphNodeKind, RepoDNAProjectV2 } from '../analyzer/v2/types';

export type AnyRepoDNAArtifact = RepoDNAProject | RepoDNAProjectV2;
export type ArtifactVersion = '1.1.0' | '2.0.0' | 'unknown';

export interface LoadedArtifact {
  version: ArtifactVersion;
  project: AnyRepoDNAArtifact;
  isV2: boolean;
  isV1: boolean;
}

/**
 * Schema validation via the CSP-safe lazy engine: full Ajv where code
 * generation is permitted, structural enforcement in browsers. Kept for
 * error-message compatibility with the previous compiled-validator API.
 */
function validationErrorText(data: unknown, version: '1.1.0' | '2.0.0', label: string): string | null {
  const result = validateAnyArtifact(data, version);
  if (result.valid) return null;
  return `Invalid RepoDNA ${label} artifact: ${result.errors.slice(0, 5).join('; ')}`;
}

export function detectArtifactVersion(data: unknown): ArtifactVersion {
  if (!data || typeof data !== 'object') return 'unknown';
  const sv = (data as { schemaVersion?: unknown }).schemaVersion;
  if (sv === '2.0.0') return '2.0.0';
  if (sv === '1.1.0' || sv === '1.1' || sv === '1') return '1.1.0';
  // Heuristic: v1 has files/symbols/imports, v2 has nodes/edges/inventory
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.nodes) && Array.isArray(obj.edges) && obj.inventory) return '2.0.0';
  if (Array.isArray(obj.files) && Array.isArray(obj.symbols)) return '1.1.0';
  return 'unknown';
}

export function validateArtifact(data: unknown): { valid: boolean; version: ArtifactVersion; errors: unknown } {
  const version = detectArtifactVersion(data);
  if (version === '2.0.0') {
    const err = validationErrorText(data, '2.0.0', 'v2');
    return { valid: err === null, version, errors: err ? [{ message: err }] : null };
  }
  if (version === '1.1.0') {
    const err = validationErrorText(data, '1.1.0', 'v1');
    return { valid: err === null, version, errors: err ? [{ message: err }] : null };
  }
  return { valid: false, version: 'unknown', errors: [{ message: 'Unknown schemaVersion' }] };
}

export function loadRepoDNAArtifact(data: unknown): LoadedArtifact {
  const version = detectArtifactVersion(data);
  if (version === '2.0.0') {
    const err = validationErrorText(data, '2.0.0', 'v2');
    if (err) throw new Error(err);
    return { version: '2.0.0', project: data as RepoDNAProjectV2, isV2: true, isV1: false };
  }
  if (version === '1.1.0') {
    const err = validationErrorText(data, '1.1.0', 'v1');
    if (err) throw new Error(err);
    return { version: '1.1.0', project: data as RepoDNAProject, isV2: false, isV1: true };
  }
  throw new Error('Unsupported or missing schemaVersion — expected 1.1.0 or 2.0.0');
}

/**
 * Adapt a v1 project into the v2 viewer shape without fabricating evidence.
 * Relationship views remain projections of the canonical graph for v2; for v1
 * the adapter simply exposes the existing architecture/flows as-is.
 */
export function adaptV1ToV2Viewer(project: RepoDNAProject): RepoDNAProjectV2 {
  const now = new Date().toISOString();
  const totalFiles = project.files.length;
  const sourceFiles = project.files.filter(
    (f) => ['Python', 'JavaScript', 'TypeScript', 'Go'].includes(f.language)
  );
  const firstPartyLoc = sourceFiles.reduce((a, f) => a + f.lines, 0);
  const parsed = project.files.filter((f) => f.parsed).length;
  const coveragePct = project.metrics.parseSuccessRate ?? (totalFiles ? Math.round((parsed / totalFiles) * 1000) / 10 : 100);

  const fileNodes: GraphNode[] = project.files.map((file) => ({
    id: file.id,
    kind: 'file',
    name: file.path.split('/').pop() || file.path,
    qualifiedName: file.path,
    path: file.path,
    language: file.language,
    range: { startLine: 1, startCol: 0, endLine: file.lines, endCol: 0 },
    confidence: file.parsed ? 1 : 0.5,
    metadata: {
      bytes: file.bytes,
      hash: file.hash,
      role: file.role,
      parsed: file.parsed,
      error: file.error,
    },
  }));
  const fileNodeIds = new Set(fileNodes.map((node) => node.id));
  const fileLanguages = new Map(project.files.map((file) => [file.path, file.language]));

  const symbolKind = (type: string): GraphNodeKind => {
    if (type === 'class') return 'class';
    if (type === 'interface') return 'interface';
    if (type === 'method') return 'method';
    if (type === 'database_model' || type === 'orm_model') return 'data_model';
    if (type === 'component') return 'component';
    if (type === 'variable' || type === 'constant') return 'variable';
    if (type === 'module') return 'module';
    return 'function';
  };
  const symbolNodes: GraphNode[] = project.symbols.map((symbol) => ({
    id: symbol.id,
    kind: symbolKind(symbol.type),
    name: symbol.name,
    qualifiedName: symbol.id,
    path: symbol.file,
    language: fileLanguages.get(symbol.file) ?? 'Unknown',
    range: {
      startLine: symbol.line,
      startCol: 0,
      endLine: symbol.endLine ?? symbol.end_line ?? symbol.line,
      endCol: 0,
    },
    evidence: symbol.evidence,
    confidence: 1,
    metadata: {
      originalType: symbol.type,
      parent: symbol.parent,
      exported: symbol.exported,
    },
  }));
  const symbolNodeIds = new Set(symbolNodes.map((node) => node.id));

  const routeNodes: GraphNode[] = project.routes.map((route) => ({
    id: route.id,
    kind: 'route',
    name: `${route.method} ${route.path}`,
    qualifiedName: route.id,
    path: route.file,
    language: fileLanguages.get(route.file) ?? 'Unknown',
    range: { startLine: route.line, startCol: 0, endLine: route.line, endCol: 0 },
    confidence: route.confidence,
    metadata: {
      method: route.method,
      routePath: route.path,
      handler: route.handler,
      framework: route.framework,
    },
  }));

  const dependencyNames = [...new Set(
    project.imports
      .filter((record) => record.external)
      .map((record) => record.module.split(/[/.]/)[0])
      .filter(Boolean)
  )].sort();
  const dependencyNodes: GraphNode[] = dependencyNames.map((name) => ({
    id: `dependency:${name}`,
    kind: 'dependency',
    name,
    qualifiedName: name,
    path: '',
    language: 'External',
    range: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
    confidence: 1,
  }));

  const defineEdges: GraphEdge[] = project.symbols.map((symbol) => ({
    id: `defines:${symbol.id}`,
    source: `file:${symbol.file}`,
    target: symbol.id,
    type: 'DEFINES',
    status: 'extracted',
    confidence: 1,
    evidence: {
      file: symbol.file,
      range: {
        startLine: symbol.line,
        startCol: 0,
        endLine: symbol.endLine ?? symbol.end_line ?? symbol.line,
        endCol: 0,
      },
    },
    explanation: `${symbol.file} defines ${symbol.type} ${symbol.name}`,
    resolver: { name: 'syntax-extractor', version: '2.0.0' },
  }));

  const importEdges: GraphEdge[] = project.imports.map((record) => {
    const externalName = record.module.split(/[/.]/)[0];
    const target = record.external
      ? `dependency:${externalName}`
      : record.target
        ? record.target.startsWith('file:') ? record.target : `file:${record.target}`
        : null;
    return {
      id: record.id,
      source: record.source.startsWith('file:') ? record.source : `file:${record.source}`,
      target,
      type: record.external ? 'DEPENDS_ON' : 'IMPORTS',
      status: target ? 'resolved' : 'unresolved',
      confidence: target ? 0.9 : 0.4,
      evidence: { file: record.source, range: { startLine: record.line, startCol: 0, endLine: record.line, endCol: 0 } },
      explanation: target ? `Import ${record.module} resolves to ${target}` : `Import ${record.module} could not be resolved`,
      resolver: { name: 'legacy-import-resolver', version: '1.2.0' },
      alternativeCandidates: [],
      unresolvedExpression: target ? null : record.module,
      metadata: { module: record.module, names: record.names, external: record.external },
    };
  });

  const callEdges: GraphEdge[] = project.calls.map((call) => {
    const source = symbolNodeIds.has(call.source)
      ? call.source
      : fileNodeIds.has(call.source)
        ? call.source
        : `file:${call.file}`;
    const target = call.target && symbolNodeIds.has(call.target) ? call.target : null;
    return {
      id: call.id,
      source,
      target,
      type: 'CALLS',
      status: target ? 'resolved' : 'unresolved',
      confidence: call.confidence,
      evidence: { file: call.file, range: { startLine: call.line, startCol: 0, endLine: call.line, endCol: 0 } },
      explanation: target ? `${call.source} calls ${target}` : `${call.source} calls unresolved expression ${call.callee}`,
      resolver: { name: 'call-resolver', version: '1.2.0' },
      alternativeCandidates: [],
      unresolvedExpression: target ? null : call.callee,
      metadata: { callee: call.callee },
    };
  });

  const routeEdges: GraphEdge[] = project.routes.flatMap((route) => {
    const fileEdge: GraphEdge = {
      id: `exposes:${route.id}`,
      source: `file:${route.file}`,
      target: route.id,
      type: 'EXPOSES_ROUTE',
      status: 'extracted',
      confidence: route.confidence,
      evidence: { file: route.file, range: { startLine: route.line, startCol: 0, endLine: route.line, endCol: 0 } },
      explanation: `${route.file} exposes ${route.method} ${route.path}`,
      resolver: { name: 'route-extractor', version: '1.2.0' },
    };
    const handlerTarget = symbolNodeIds.has(route.handler) ? route.handler : null;
    const handlerEdge: GraphEdge = {
      id: `handles:${route.id}`,
      source: route.id,
      target: handlerTarget,
      type: 'HANDLES',
      status: handlerTarget ? 'resolved' : 'unresolved',
      confidence: handlerTarget ? route.confidence : Math.min(route.confidence, 0.5),
      evidence: { file: route.file, range: { startLine: route.line, startCol: 0, endLine: route.line, endCol: 0 } },
      explanation: handlerTarget
        ? `${route.method} ${route.path} is handled by ${route.handler}`
        : `Handler ${route.handler} could not be linked to an extracted symbol`,
      resolver: { name: 'route-handler-resolver', version: '2.0.0' },
      unresolvedExpression: handlerTarget ? null : route.handler,
      alternativeCandidates: [],
    };
    return [fileEdge, handlerEdge];
  });

  const graphNodes = [...fileNodes, ...symbolNodes, ...routeNodes, ...dependencyNodes];
  const graphEdges = [...defineEdges, ...importEdges, ...callEdges, ...routeEdges];
  const unresolved = graphEdges
    .filter((edge) => edge.status === 'unresolved' || edge.status === 'ambiguous')
    .map((edge) => ({
      edgeId: edge.id,
      reason: edge.type === 'CALLS' ? 'unresolved call' : edge.type === 'HANDLES' ? 'unresolved route handler' : 'unresolved import',
      candidates: edge.alternativeCandidates ?? [],
    }));

  return {
    schemaVersion: '2.0.0',
    generatedAt: project.generatedAt || now,
    repository: {
      name: project.repository.name,
      source: project.repository.source,
      commitSha: null,
      analyzedRef: null,
      languages: project.repository.languages,
      fingerprint: {
        languages: project.repository.fingerprint.languages,
        frameworks: project.repository.fingerprint.frameworks,
        infrastructure: project.repository.fingerprint.infrastructure,
        databases: project.repository.fingerprint.databases,
        externalSystems: project.repository.fingerprint.externalSystems,
        testing: project.repository.fingerprint.testing,
        buildTools: project.repository.fingerprint.buildTools,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tooling: (project.repository.fingerprint as any).tooling ?? [],
        languageFileCounts: ((project.repository.fingerprint as unknown as { languageFileCounts?: Record<string, number> }).languageFileCounts) ?? {},
      },
    },
    inventory: {
      totalFileCount: totalFiles,
      totalBytes: project.files.reduce((a, f) => a + f.bytes, 0),
      firstPartySourceFileCount: project.repository.sourceFileCount,
      firstPartyLoc,
      candidateFileCount: totalFiles,
      parsedFileCount: parsed,
      partiallyParsedFileCount: project.diagnostics.filter((d) => d.code === 'SOURCE_PARSE_PARTIAL').length,
      failedFileCount: project.diagnostics.filter((d) => d.code === 'SOURCE_PARSE_FAILED').length,
      unsupportedSourceFileCount: totalFiles - project.repository.sourceFileCount,
      ignoredFileCount: 0,
      generatedFileCount: 0,
      packageCount: Object.keys(((project.repository.fingerprint as unknown as { languageFileCounts?: Record<string, number> }).languageFileCounts) ?? {}).length,
      declaredDependencyCount: project.metrics.localDependencies + project.metrics.externalDependencies,
      skippedByReason: project.diagnostics
        .filter((d) => d.code.startsWith('skipped_'))
        .reduce<Record<string, number>>((acc, d) => {
          const reason = d.code.replace('skipped_', '');
          acc[reason] = (acc[reason] ?? 0) + 1;
          return acc;
        }, {}),
      languageCoverage: ((project.repository.fingerprint as unknown as { languageFileCounts?: Record<string, number> }).languageFileCounts) ?? {},
    },
    coverage: {
      percentage: coveragePct,
      parsed,
      partial: project.diagnostics.filter((d) => d.code === 'SOURCE_PARSE_PARTIAL').length,
      unsupported: totalFiles - project.repository.sourceFileCount,
      ignored: 0,
      skipped: project.diagnostics.filter((d) => d.code.startsWith('skipped_')).length,
      truncationReasons: project.diagnostics
        .filter((d) => ['TOO_MANY_FILES', 'TOO_MANY_ARCHIVE_ENTRIES', 'EXTRACTED_TOO_LARGE'].includes(d.code))
        .map((d) => d.code),
    },
    nodes: graphNodes,
    edges: graphEdges,
    architecture: project.architecture,
    flows: project.flows,
    communities: [],
    dependencyCycles: project.metrics.dependencyCycles,
    centrality: {
      mostConnected: project.metrics.mostConnectedFiles.map((f) => ({
        nodeId: `file:${f.file}`,
        inDegree: f.connections,
        outDegree: 0,
        score: f.connections,
      })),
      highCoupling: project.metrics.highCouplingFiles.map((f) => ({ nodeId: `file:${f.file}`, connections: f.connections })),
      godNodes: [],
    },
    unresolved,
    diagnostics: project.diagnostics,
    timings: { stages: {}, totalMs: 0 },
    parsers: { versions: {}, mode: 'legacy' },
    security: {
      limits: project.metadata.limits,
      truncated: [],
      executedRepositoryCode: false,
    },
    completeness: {
      status:
        coveragePct === 100 && project.diagnostics.filter((d) => d.severity === 'warning').length === 0
          ? 'FULLY_MAPPED'
          : coveragePct >= 70
            ? 'MOSTLY_MAPPED'
            : 'PARTIAL',
      reasons:
        coveragePct === 100 ? [] : [`parseSuccessRate ${coveragePct}%`],
    },
    entrypoints: project.entrypoints,
    databases: project.databases,
    externalSystems: project.externalSystems,
    external_systems: project.external_systems,
    metadata: project.metadata,
  };
}
