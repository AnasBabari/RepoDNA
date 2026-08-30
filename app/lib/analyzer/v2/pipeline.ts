import { analyzeRepositoryFiles, resolveParserMode, type AnalyzeOptions, type AnalyzeProgress } from '../index';
import { DEFAULT_INGESTION_LIMITS } from '../types';
import type { DiscoveredFile } from '../types';
import type { IngestionInventory } from '../types';
import { adaptV1ToV2Viewer } from '../../schema/artifact-loader';
import type { GraphEdge, GraphNode, RepoDNAProjectV2 } from './types';
import { detectCentrality, detectCommunities, detectDependencyCycles } from './analytics';

const DEFAULT_GRAPH_LIMITS = {
  // The full repository inventory is retained separately. These caps keep a
  // browser-loaded artifact and its interactive graph responsive on very large
  // repositories while preserving a deterministic high-signal subgraph.
  maxNodes: 8_000,
  maxEdges: 12_000,
} as const;

const STRUCTURAL_NODE_KINDS = new Set([
  'repository', 'workspace', 'package', 'directory', 'module', 'file', 'route',
  'dependency', 'configuration', 'external_system',
]);

const EDGE_PRIORITY: Record<string, number> = {
  EXPOSES_ROUTE: 7,
  HANDLES: 7,
  INVOKES: 6,
  READS: 6,
  WRITES: 6,
  INHERITS: 5,
  IMPLEMENTS: 5,
  DEFINES: 4,
  IMPORTS: 4,
  DEPENDS_ON: 4,
  CONTAINS: 3,
  CONFIGURES: 3,
  CALLS: 2,
};

function compactGraph(project: RepoDNAProjectV2, limits: { maxNodes: number; maxEdges: number }): string[] {
  const originalNodeCount = project.nodes.length;
  const originalEdgeCount = project.edges.length;
  if (originalNodeCount <= limits.maxNodes && originalEdgeCount <= limits.maxEdges) return [];

  const nodeIds = new Set(project.nodes.map((node) => node.id));
  const degree = new Map<string, number>();
  for (const edge of project.edges) {
    if (nodeIds.has(edge.source)) degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    if (edge.target && nodeIds.has(edge.target)) degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  const entrypointFiles = new Set((project.entrypoints ?? []).map((entrypoint) => `file:${entrypoint.file}`));
  const centralFiles = new Set(project.centrality.mostConnected.map((item) => item.nodeId));
  const nodeRank = (node: GraphNode): number => {
    const anchor = entrypointFiles.has(node.id) || centralFiles.has(node.id) ? 1_000_000 : 0;
    const structural = STRUCTURAL_NODE_KINDS.has(node.kind) ? 100_000 : 0;
    return anchor + structural + (degree.get(node.id) ?? 0);
  };

  const rankedNodes = [...project.nodes].sort(
    (a, b) => nodeRank(b) - nodeRank(a) || a.id.localeCompare(b.id)
  );
  const rankedFileNodes = rankedNodes.filter((node) => node.kind === 'file');
  const rankedStructuralNodes = rankedNodes.filter((node) => STRUCTURAL_NODE_KINDS.has(node.kind) && node.kind !== 'file');
  const rankedSymbolNodes = rankedNodes.filter((node) => !STRUCTURAL_NODE_KINDS.has(node.kind));
  // File nodes are the navigable source inventory. Preserve as many of them as
  // the graph budget allows before spending the remaining budget on symbols.
  // This keeps architecture components and file-level navigation truthful on
  // large repositories where the graph itself must be compacted.
  const fileBudget = Math.min(limits.maxNodes, rankedFileNodes.length);
  const keptFileNodes = rankedFileNodes.slice(0, fileBudget);
  const remainingBudget = Math.max(0, limits.maxNodes - keptFileNodes.length);
  const keptNodeIds = new Set([
    ...keptFileNodes,
    ...rankedStructuralNodes.slice(0, remainingBudget),
    ...rankedSymbolNodes.slice(0, Math.max(0, remainingBudget - Math.min(remainingBudget, rankedStructuralNodes.length))),
  ].map((node) => node.id));
  project.nodes = project.nodes.filter((node) => keptNodeIds.has(node.id));

  const edgeRank = (edge: GraphEdge): number => {
    const endpointDegree = (degree.get(edge.source) ?? 0) + (edge.target ? degree.get(edge.target) ?? 0 : 0);
    const resolved = edge.target ? 10_000 : 0;
    return (EDGE_PRIORITY[edge.type] ?? 1) * 1_000_000 + resolved + endpointDegree;
  };
  const eligibleEdges = project.edges
    .filter((edge) => keptNodeIds.has(edge.source) && (!edge.target || keptNodeIds.has(edge.target)))
    .sort((a, b) => edgeRank(b) - edgeRank(a) || a.id.localeCompare(b.id));

  // Keep relationship families balanced. A large Python repository can have
  // hundreds of thousands of CALLS/DEFINES edges; selecting only the first
  // family would make the graph look falsely one-dimensional.
  const selectedEdges: GraphEdge[] = [];
  const selectedEdgeIds = new Set<string>();
  const take = (candidates: GraphEdge[], budget: number) => {
    for (const edge of candidates.slice(0, budget)) {
      selectedEdges.push(edge);
      selectedEdgeIds.add(edge.id);
    }
  };
  take(eligibleEdges.filter((edge) => edge.type === 'CALLS'), Math.floor(limits.maxEdges * 0.45));
  take(eligibleEdges.filter((edge) => edge.type === 'DEFINES'), Math.floor(limits.maxEdges * 0.2));
  take(
    eligibleEdges.filter((edge) => edge.type === 'IMPORTS' || edge.type === 'DEPENDS_ON'),
    Math.floor(limits.maxEdges * 0.2)
  );
  for (const edge of eligibleEdges) {
    if (selectedEdges.length >= limits.maxEdges) break;
    if (!selectedEdgeIds.has(edge.id)) {
      selectedEdges.push(edge);
      selectedEdgeIds.add(edge.id);
    }
  }
  selectedEdges.sort((a, b) => a.id.localeCompare(b.id));
  project.edges = selectedEdges;
  project.unresolved = project.unresolved.filter((item) => selectedEdgeIds.has(item.edgeId));

  const truncationCodes: string[] = [];
  if (project.nodes.length < originalNodeCount) {
    truncationCodes.push('GRAPH_NODES_COMPACTED');
    project.diagnostics.push({
      severity: 'warning',
      code: 'GRAPH_NODES_COMPACTED',
      message: `The repository produced ${originalNodeCount.toLocaleString()} graph entities; showing ${project.nodes.length.toLocaleString()} highest-signal entities while preserving the full repository inventory.`,
      file: null,
    });
  }
  if (eligibleEdges.length < originalEdgeCount || project.edges.length < eligibleEdges.length) {
    truncationCodes.push('GRAPH_EDGES_COMPACTED');
    project.diagnostics.push({
      severity: 'warning',
      code: 'GRAPH_EDGES_COMPACTED',
      message: `The repository produced ${originalEdgeCount.toLocaleString()} graph relationships; showing ${project.edges.length.toLocaleString()} balanced, highest-signal relationships with evidence.`,
      file: null,
    });
  }
  project.inventory.truncation = {
    hitLimits: [...(project.inventory.truncation?.hitLimits ?? []), ...truncationCodes],
    maxFilesReached: project.inventory.truncation?.maxFilesReached ?? false,
    maxBytesReached: project.inventory.truncation?.maxBytesReached ?? false,
  };
  return truncationCodes;
}

export interface V2AnalyzeOptions extends AnalyzeOptions {
  commitSha?: string | null;
  analyzedRef?: string | null;
  graphLimits?: { maxNodes?: number; maxEdges?: number };
  inventoryOverride?: {
    totalFileCount?: number;
    totalBytes?: number;
    ignoredFileCount?: number;
    generatedFileCount?: number;
  };
}

export async function analyzeRepositoryV2(
  discovery: { files: DiscoveredFile[]; skipped: { path: string; reason: string }[]; name: string; source: string; inventory?: IngestionInventory },
  options?: V2AnalyzeOptions
): Promise<RepoDNAProjectV2> {
  const start = Date.now();
  const timings: Record<string, number> = {};
  const ingestionLimits = options?.ingestionLimits ?? DEFAULT_INGESTION_LIMITS;
  const reportProgress = async (progress: AnalyzeProgress): Promise<void> => {
    await options?.onProgress?.(progress);
  };

  const t0 = Date.now();
  const v1 = await analyzeRepositoryFiles(discovery, options);
  timings.parse = Date.now() - t0;

  const t1 = Date.now();
  await reportProgress({
    stage: 'resolve_relationships',
    completed: 5,
    total: 6,
    message: 'Materializing the canonical graph entities',
  });
  // Convert via adapter (no fabricated evidence, preserves v1 architecture as projection)
  const v2 = adaptV1ToV2Viewer(v1);
  timings.adapt = Date.now() - t1;
  await reportProgress({
    stage: 'resolve_relationships',
    completed: 6,
    total: 6,
    message: `Materialized ${v2.nodes.length.toLocaleString()} graph entities`,
  });

  // Enrich with inventory truth (from ingestion if available, else derived)
  const ingestionInventory = discovery.inventory;
  if (ingestionInventory) {
    v2.inventory.totalFileCount = ingestionInventory.totalFileCount ?? v2.inventory.totalFileCount;
    v2.inventory.totalBytes = ingestionInventory.totalBytes ?? v2.inventory.totalBytes;
    v2.inventory.ignoredFileCount = ingestionInventory.ignoredFileCount ?? v2.inventory.ignoredFileCount;
    v2.inventory.generatedFileCount = ingestionInventory.generatedFileCount ?? v2.inventory.generatedFileCount;
    // firstParty counts from v1 are already truthful (including Go)
    if (typeof ingestionInventory.firstPartySourceFileCount === 'number') {
      v2.inventory.firstPartySourceFileCount = ingestionInventory.firstPartySourceFileCount;
    }
    if (typeof ingestionInventory.candidateFileCount === 'number') {
      v2.inventory.candidateFileCount = ingestionInventory.candidateFileCount;
    }
    if (typeof ingestionInventory.unsupportedSourceFileCount === 'number') {
      v2.inventory.unsupportedSourceFileCount = ingestionInventory.unsupportedSourceFileCount;
    }
    if (ingestionInventory.skippedByReason) {
      v2.inventory.skippedByReason = { ...ingestionInventory.skippedByReason };
    }
    if (ingestionInventory.acquisitionMode) {
      v2.inventory.acquisitionMode = ingestionInventory.acquisitionMode;
    }
    if (typeof ingestionInventory.repositorySizeKb === 'number') {
      v2.inventory.repositorySizeKb = ingestionInventory.repositorySizeKb;
    }
    if (ingestionInventory.truncation) {
      v2.inventory.truncation = {
        hitLimits: [...ingestionInventory.truncation.hitLimits],
        maxFilesReached: ingestionInventory.truncation.maxFilesReached,
        maxBytesReached: ingestionInventory.truncation.maxBytesReached,
      };
      v2.coverage.truncationReasons = [
        ...new Set([
          ...v2.coverage.truncationReasons,
          ...ingestionInventory.truncation.hitLimits,
        ]),
      ];
      for (const code of ingestionInventory.truncation.hitLimits) {
        if (v2.diagnostics.some((d) => d.code === code)) continue;
        if (code === 'GITHUB_TREE_TRUNCATED') {
          v2.diagnostics.push({
            severity: 'warning',
            code,
            message:
              'GitHub tree response was truncated; directory traversal may be incomplete and coverage is partial. Check inventory.truncation and skippedByReason for details.',
            file: null,
          });
        } else if (code === 'TOO_MANY_FILES') {
          v2.diagnostics.push({
            severity: 'warning',
            code,
            message: `Candidate file count exceeded limit of ${ingestionInventory.candidateFileCount?.toLocaleString?.() ?? 'max'}; analysis is partial and some files were skipped.`,
            file: null,
          });
        }
      }
    }
  }
  // Override where provided
  if (options?.inventoryOverride) {
    if (typeof options.inventoryOverride.totalFileCount === 'number') v2.inventory.totalFileCount = options.inventoryOverride.totalFileCount;
  }

  // Coverage derived from v1
  v2.coverage.percentage = v1.metrics.parseSuccessRate;
  v2.coverage.parsed = v1.repository.parsedFileCount;
  v2.coverage.partial = v2.inventory.partiallyParsedFileCount;
  v2.coverage.unsupported = v2.inventory.unsupportedSourceFileCount;
  v2.coverage.ignored = v2.inventory.ignoredFileCount;
  v2.coverage.skipped = v2.inventory.skippedByReason ? Object.values(v2.inventory.skippedByReason as Record<string, number>).reduce((a, b) => a + b, 0) : 0;
  const coverageSourceTotal = ingestionInventory?.firstPartySourceFileCount ?? v1.repository.sourceFileCount;
  if (coverageSourceTotal > 0) {
    v2.coverage.percentage = Math.round((v2.coverage.parsed / coverageSourceTotal) * 1000) / 10;
  }

  // Repository identity with commit
  v2.repository.commitSha = options?.commitSha ?? null;
  v2.repository.analyzedRef = options?.analyzedRef ?? null;
  v2.repository.source = discovery.source;

  const graphLimits = {
    maxNodes: Math.max(1, Math.floor(options?.graphLimits?.maxNodes ?? DEFAULT_GRAPH_LIMITS.maxNodes)),
    maxEdges: Math.max(1, Math.floor(options?.graphLimits?.maxEdges ?? DEFAULT_GRAPH_LIMITS.maxEdges)),
  };
  const tCompact = Date.now();
  const graphTruncation = compactGraph(v2, graphLimits);
  timings.compact = Date.now() - tCompact;
  v2.coverage.truncationReasons = [...new Set([...v2.coverage.truncationReasons, ...graphTruncation])];

  // Analytics (deterministic)
  const t2 = Date.now();
  await reportProgress({
    stage: 'analytics',
    completed: 0,
    total: 3,
    message: 'Detecting graph communities',
  });
  v2.communities = detectCommunities(v2.nodes, v2.edges);
  await reportProgress({
    stage: 'analytics',
    completed: 1,
    total: 3,
    message: 'Checking dependency cycles',
  });
  v2.dependencyCycles = detectDependencyCycles(v2.edges);
  await reportProgress({
    stage: 'analytics',
    completed: 2,
    total: 3,
    message: 'Computing centrality and coupling signals',
  });
  v2.centrality = detectCentrality(v2.nodes, v2.edges);
  await reportProgress({
    stage: 'analytics',
    completed: 3,
    total: 3,
    message: 'Graph analytics complete',
  });
  timings.analytics = Date.now() - t2;

  // Security limits
  v2.security = {
    limits: {
      maxArchiveEntries: ingestionLimits.maxArchiveEntries,
      maxFiles: ingestionLimits.maxFiles,
      maxFileBytes: ingestionLimits.maxFileBytes,
      maxArchiveBytes: ingestionLimits.maxArchiveBytes,
      maxTotalExtractedBytes: ingestionLimits.maxTotalExtractedBytes,
      maxAstNodes: 25000,
      maxAstDepth: 128,
      maxGraphNodes: graphLimits.maxNodes,
      maxGraphEdges: graphLimits.maxEdges,
    },
    truncated: [...new Set([
      ...v1.diagnostics.filter((d) => ['TOO_MANY_FILES', 'TOO_MANY_ARCHIVE_ENTRIES', 'EXTRACTED_TOO_LARGE', 'ARCHIVE_TOO_LARGE'].includes(d.code)).map((d) => d.code),
      ...(v2.inventory.truncation?.hitLimits ?? []),
      ...graphTruncation,
    ])],
    executedRepositoryCode: false as const,
  };

  // Parsers
  v2.parsers = {
    versions: {
      'tree-sitter': '0.26.12',
      'tree-sitter-python': '0.25.0',
      'tree-sitter-javascript': '0.25.0',
      'tree-sitter-typescript': '0.23.2',
      'tree-sitter-tsx': '0.23.2',
      'tree-sitter-go': '0.25.0',
    },
    mode: resolveParserMode(options),
  };

  v2.metadata = {
    ...v2.metadata,
    analyzerVersion: '2.0.0',
    analysisMode: 'canonical-graph',
  };

  // Timings
  const totalMs = Date.now() - start;
  v2.timings = { stages: timings, totalMs };

  // Completeness
  const hasUnresolved = v2.unresolved.length > 0 || v2.edges.some((e) => e.status === 'unresolved' || e.status === 'ambiguous');
  const hasTruncation = v2.security.truncated.length > 0;
  const parseOk = v1.metrics.parseSuccessRate === 100;
  if (parseOk && !hasUnresolved && !hasTruncation) {
    v2.completeness = { status: 'FULLY_MAPPED', reasons: [] };
  } else if (hasTruncation) {
    v2.completeness = { status: 'COVERAGE_LIMITED', reasons: [...v2.security.truncated, hasUnresolved ? 'unresolved relationships' : ''].filter(Boolean) };
  } else if (!parseOk || hasUnresolved) {
    v2.completeness = { status: parseOk ? 'MOSTLY_MAPPED' : 'PARTIAL', reasons: hasUnresolved ? ['unresolved relationships'] : [`parseSuccessRate ${v1.metrics.parseSuccessRate}%`] };
  } else {
    v2.completeness = { status: 'MOSTLY_MAPPED', reasons: [] };
  }

  // Ensure deterministic ordering for nodes/edges
  v2.nodes.sort((a, b) => a.id.localeCompare(b.id));
  v2.edges.sort((a, b) => a.id.localeCompare(b.id));

  // Fingerprint already via v1, but ensure deterministic
  return v2;
}

export function getDeepAnalysisMode(): 'off' | 'dual' | 'on' {
  const raw = (process.env.REPODNA_DEEP_ANALYSIS || 'off').toLowerCase().trim();
  if (raw === 'on' || raw === 'dual' || raw === 'off') return raw;
  return 'off';
}
