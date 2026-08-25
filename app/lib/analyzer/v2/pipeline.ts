import { analyzeRepositoryFiles, type AnalyzeOptions } from '../index';
import type { DiscoveredFile } from '../types';
import type { IngestionInventory } from '../types';
import { adaptV1ToV2Viewer } from '../../schema/artifact-loader';
import type { RepoDNAProjectV2 } from './types';
import { detectCentrality, detectCommunities, detectDependencyCycles } from './analytics';

export interface V2AnalyzeOptions extends AnalyzeOptions {
  commitSha?: string | null;
  analyzedRef?: string | null;
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

  const t0 = Date.now();
  const v1 = await analyzeRepositoryFiles(discovery, options);
  timings.parse = Date.now() - t0;

  const t1 = Date.now();
  // Convert via adapter (no fabricated evidence, preserves v1 architecture as projection)
  const v2 = adaptV1ToV2Viewer(v1);
  timings.adapt = Date.now() - t1;

  // Enrich with inventory truth (from ingestion if available, else derived)
  const ingestionInventory = (discovery as unknown as { inventory?: { totalFileCount?: number; totalBytes?: number; firstPartySourceFileCount?: number; candidateFileCount?: number; ignoredFileCount?: number; generatedFileCount?: number; unsupportedSourceFileCount?: number } }).inventory;
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

  // Repository identity with commit
  v2.repository.commitSha = options?.commitSha ?? null;
  v2.repository.analyzedRef = options?.analyzedRef ?? null;
  v2.repository.source = discovery.source;

  // Analytics (deterministic)
  const t2 = Date.now();
  v2.communities = detectCommunities(v2.nodes, v2.edges);
  v2.dependencyCycles = detectDependencyCycles(v2.edges);
  v2.centrality = detectCentrality(v2.nodes, v2.edges);
  timings.analytics = Date.now() - t2;

  // Security limits
  v2.security = {
    limits: {
      maxArchiveEntries: 20000,
      maxFiles: 10000,
      maxFileBytes: 1000000,
      maxArchiveBytes: 25 * 1024 * 1024,
      maxTotalExtractedBytes: 100 * 1024 * 1024,
      maxAstNodes: 25000,
      maxAstDepth: 128,
    },
    truncated: v1.diagnostics.filter((d) => ['TOO_MANY_FILES', 'TOO_MANY_ARCHIVE_ENTRIES', 'EXTRACTED_TOO_LARGE', 'ARCHIVE_TOO_LARGE'].includes(d.code)).map((d) => d.code),
    executedRepositoryCode: false as const,
  };

  // Parsers
  v2.parsers = {
    versions: { 'tree-sitter': '0.26.12', 'tree-sitter-python': '0.25.0', 'tree-sitter-javascript': '0.23.0', 'tree-sitter-go': '0.23.0' },
    mode: 'tree-sitter',
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
