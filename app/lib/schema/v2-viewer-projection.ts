import type { RepoDNAProjectV2 } from '../analyzer/v2/types';
import type {
  CallRecord,
  FileRecord,
  ImportRecord,
  RepoDNAProject,
  RouteRecord,
  SymbolRecord,
} from '../types';

const NON_SYMBOL_KINDS = new Set([
  'repository',
  'workspace',
  'package',
  'directory',
  'file',
  'route',
  'dependency',
  'configuration',
  'external_system',
]);

function numberMetadata(metadata: Record<string, unknown> | undefined, key: string, fallback = 0) {
  const value = metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringMetadata(metadata: Record<string, unknown> | undefined, key: string, fallback = '') {
  const value = metadata?.[key];
  return typeof value === 'string' ? value : fallback;
}

/**
 * Projects the canonical v2 graph into the legacy workspace view model.
 * The projection is deterministic and evidence-preserving; the original v2
 * artifact remains authoritative for Code Graph and JSON/TXT exports.
 */
export function projectV2ForWorkspace(project: RepoDNAProjectV2): RepoDNAProject {
  const nodesById = new Map(project.nodes.map((node) => [node.id, node]));
  const fileNodes = project.nodes.filter((node) => node.kind === 'file');

  const files: FileRecord[] = fileNodes.map((node) => ({
    id: node.id,
    path: node.path,
    language: node.language,
    lines: Math.max(0, node.range.endLine),
    bytes: numberMetadata(node.metadata, 'bytes'),
    hash: stringMetadata(node.metadata, 'hash'),
    role: stringMetadata(node.metadata, 'role', 'source'),
    parsed: node.metadata?.parsed !== false,
    error: typeof node.metadata?.error === 'string' ? node.metadata.error : null,
  }));
  const knownFilePaths = new Set(files.map((file) => file.path));
  const architectureComponents = project.architecture.components
    .map((component) => ({
      ...component,
      // A compacted graph may omit low-signal file nodes. Do not let the
      // legacy workspace projection display component paths that it cannot
      // navigate to; the canonical v2 artifact and inventory remain intact.
      files: component.files.filter((file) => knownFilePaths.has(file)),
    }))
    .filter((component) => component.files.length > 0);
  const architectureComponentIds = new Set(architectureComponents.map((component) => component.id));
  const architecture = {
    components: architectureComponents,
    connections: project.architecture.connections.filter(
      (connection) => architectureComponentIds.has(connection.source) && architectureComponentIds.has(connection.target)
    ),
  };

  const symbols: SymbolRecord[] = project.nodes
    .filter((node) => !NON_SYMBOL_KINDS.has(node.kind))
    .map((node) => ({
      id: node.id,
      type: stringMetadata(node.metadata, 'originalType', node.kind),
      name: node.name,
      file: node.path,
      line: node.range.startLine,
      endLine: node.range.endLine,
      end_line: node.range.endLine,
      parent: typeof node.metadata?.parent === 'string' ? node.metadata.parent : null,
      exported: node.metadata?.exported === true,
      evidence: node.evidence ?? [],
    }));

  const imports: ImportRecord[] = project.edges
    .filter((edge) => edge.type === 'IMPORTS' || edge.type === 'DEPENDS_ON')
    .map((edge) => {
      const sourceNode = nodesById.get(edge.source);
      const targetNode = edge.target ? nodesById.get(edge.target) : undefined;
      const external = edge.type === 'DEPENDS_ON' || edge.metadata?.external === true;
      return {
        id: edge.id,
        source: sourceNode?.path || edge.evidence.file,
        module: stringMetadata(edge.metadata, 'module', edge.unresolvedExpression ?? targetNode?.qualifiedName ?? ''),
        names: Array.isArray(edge.metadata?.names)
          ? edge.metadata.names.filter((name): name is string => typeof name === 'string')
          : [],
        line: edge.evidence.range.startLine,
        target: external ? null : targetNode?.path ?? null,
        external,
      };
    });

  const calls: CallRecord[] = project.edges
    .filter((edge) => edge.type === 'CALLS')
    .map((edge) => {
      const sourceNode = nodesById.get(edge.source);
      const targetNode = edge.target ? nodesById.get(edge.target) : undefined;
      return {
        id: edge.id,
        source: sourceNode?.qualifiedName ?? edge.source,
        callee: stringMetadata(edge.metadata, 'callee', edge.unresolvedExpression ?? targetNode?.name ?? ''),
        file: edge.evidence.file,
        line: edge.evidence.range.startLine,
        target: targetNode?.qualifiedName ?? null,
        confidence: edge.confidence,
      };
    });

  const routes: RouteRecord[] = project.nodes
    .filter((node) => node.kind === 'route')
    .map((node) => ({
      id: node.id,
      method: stringMetadata(node.metadata, 'method', 'ANY'),
      path: stringMetadata(node.metadata, 'routePath', node.name),
      handler: stringMetadata(node.metadata, 'handler'),
      file: node.path,
      line: node.range.startLine,
      framework: stringMetadata(node.metadata, 'framework', 'Unknown'),
      confidence: node.confidence ?? 0.5,
    }));

  const fileComponents: Record<string, string> = {};
  for (const component of architecture.components) {
    for (const file of component.files) fileComponents[file] = component.id;
  }

  const importantFiles = project.centrality.mostConnected
    .map((item) => {
      const node = nodesById.get(item.nodeId);
      return node?.path
        ? { file: node.path, score: item.score, reasons: [`${item.inDegree} inbound and ${item.outDegree} outbound graph links`] }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const onboarding = (project.entrypoints ?? []).slice(0, 5).map((entrypoint, index) => ({
    step: index + 1,
    title: `Start with ${entrypoint.kind}`,
    file: entrypoint.file,
    description: entrypoint.evidence[0] ?? `Review this ${entrypoint.kind} entrypoint.`,
  }));

  const technologies = [...new Set([
    ...project.repository.fingerprint.languages,
    ...project.repository.fingerprint.frameworks,
    ...project.repository.fingerprint.infrastructure,
    ...project.repository.fingerprint.databases,
    ...project.repository.fingerprint.buildTools,
  ])];
  const complexityScore = Math.min(
    100,
    Math.round(
      (project.edges.length / Math.max(1, project.nodes.length)) * 20 +
      project.dependencyCycles.length * 8 +
      project.centrality.godNodes.length * 5
    )
  );

  return {
    schemaVersion: '1.1.0',
    generatedAt: project.generatedAt,
    repository: {
      name: project.repository.name,
      source: project.repository.source,
      languages: project.repository.languages,
      fileCount: files.length,
      sourceFileCount: Math.min(files.length, project.inventory.firstPartySourceFileCount),
      parsedFileCount: files.filter((file) => file.parsed).length,
      lines: project.inventory.firstPartyLoc,
      fingerprint: {
        languages: project.repository.fingerprint.languages,
        frameworks: project.repository.fingerprint.frameworks,
        infrastructure: project.repository.fingerprint.infrastructure,
        databases: project.repository.fingerprint.databases,
        externalSystems: project.repository.fingerprint.externalSystems,
        testing: project.repository.fingerprint.testing,
        buildTools: project.repository.fingerprint.buildTools,
      },
    },
    technologies,
    files,
    symbols,
    imports,
    calls,
    routes,
    databases: project.databases ?? [],
    externalSystems: project.externalSystems ?? project.external_systems ?? [],
    external_systems: project.external_systems ?? project.externalSystems ?? [],
    entrypoints: project.entrypoints ?? [],
    flows: project.flows,
    architecture,
    importantFiles,
    important_files: importantFiles,
    onboarding,
    metrics: {
      complexityScore,
      localDependencies: imports.filter((record) => !record.external && record.target).length,
      externalDependencies: imports.filter((record) => record.external).length,
      dependencyCycles: project.dependencyCycles,
      mostConnectedFiles: importantFiles.map((file) => ({ file: file.file, connections: file.score })),
      highCouplingFiles: project.centrality.highCoupling
        .map((item) => {
          const node = nodesById.get(item.nodeId);
          return node?.path ? { file: node.path, connections: item.connections } : null;
        })
        .filter((item): item is NonNullable<typeof item> => item !== null),
      symbols: symbols.length,
      routes: routes.length,
      components: architecture.components.length,
      parseSuccessRate: project.coverage.percentage,
    },
    diagnostics: project.diagnostics,
    metadata: {
      analysisMode: project.metadata?.analysisMode ?? 'canonical-graph-projection',
      executedRepositoryCode: project.security.executedRepositoryCode,
      analyzerVersion: project.metadata?.analyzerVersion,
      limits: {
        maxFiles: project.security.limits.maxFiles ?? 10_000,
        maxFileBytes: project.security.limits.maxFileBytes ?? 1_000_000,
        maxArchiveBytes: project.security.limits.maxArchiveBytes,
        maxTotalExtractedBytes: project.security.limits.maxTotalExtractedBytes,
      },
      fileComponents,
      cache: project.metadata?.cache ?? { hits: 0, misses: 0 },
    },
  };
}
