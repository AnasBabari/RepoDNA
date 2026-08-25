import { validateAnyArtifact } from './safe-validator';
import type { RepoDNAProject } from '../types';
import type { RepoDNAProjectV2 } from '../analyzer/v2/types';

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
    nodes: project.files.map((f) => ({
      id: f.id,
      kind: 'file' as const,
      name: f.path.split('/').pop() || f.path,
      qualifiedName: f.path,
      path: f.path,
      language: f.language,
      range: { startLine: 1, startCol: 0, endLine: f.lines, endCol: 0 },
      confidence: f.parsed ? 1 : 0.5,
    })),
    edges: project.imports.map((imp) => ({
      id: imp.id,
      // Adapter nodes use `file:<path>` IDs; imports carry raw paths.
      source: imp.source.startsWith('file:') ? imp.source : `file:${imp.source}`,
      target: imp.target
        ? imp.target.startsWith('file:')
          ? imp.target
          : `file:${imp.target}`
        : null,
      type: 'IMPORTS' as const,
      status: imp.target ? ('resolved' as const) : ('unresolved' as const),
      confidence: imp.target ? 0.9 : 0.4,
      evidence: { file: imp.source, range: { startLine: imp.line, startCol: 0, endLine: imp.line, endCol: 0 } },
      explanation: imp.target ? `Import ${imp.module} resolves to ${imp.target}` : `Import ${imp.module} could not be resolved`,
      resolver: { name: 'legacy-import-resolver', version: '1.1.0' },
      alternativeCandidates: [],
      unresolvedExpression: imp.target ? null : imp.module,
    })),
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
    unresolved: project.imports
      .filter((imp) => !imp.target && !imp.external)
      .map((imp) => ({ edgeId: imp.id, reason: 'unresolved import', candidates: [] })),
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
