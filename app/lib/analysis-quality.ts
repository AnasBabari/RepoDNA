import type { RepoDNAProject } from './types';
import type { RepoDNAProjectV2 } from './analyzer/v2/types';
import { resolveGraphScope } from './graph-scope';

export type CompletenessStatus = 'FULLY_MAPPED' | 'MOSTLY_MAPPED' | 'PARTIAL' | 'COVERAGE_LIMITED';
export const COMPLETENESS_LABELS: Record<CompletenessStatus, string> = {
  FULLY_MAPPED: 'Fully mapped', MOSTLY_MAPPED: 'Mostly mapped',
  PARTIAL: 'Partially mapped', COVERAGE_LIMITED: 'Coverage limited',
};

/** Conservative shared interpretation, including older optimistic artifacts. */
export function analysisQuality(project: RepoDNAProject | RepoDNAProjectV2) {
  const isV2 = 'nodes' in project;
  const partial = isV2 ? project.inventory.partiallyParsedFileCount : project.files.filter((file) => file.parsed && file.error).length;
  const failed = isV2 ? project.inventory.failedFileCount : project.files.filter((file) => !file.parsed && file.error).length;
  const scope = isV2 ? resolveGraphScope(project) : null;
  const unresolved = isV2
    ? scope!.original.unresolvedRelationships
    : new Set([...project.calls.filter((call) => !call.target).map((call) => call.id), ...project.imports.filter((item) => !item.target && !item.external).map((item) => item.id)]).size;
  const limitNotices = isV2 ? project.inventory.extractionLimits ?? [] : project.metadata.extractionLimits ?? [];
  const truncation = isV2 ? [...project.coverage.truncationReasons, ...project.security.truncated, ...(project.inventory.truncation?.hitLimits ?? [])] : [];
  const limitDiagnostics = project.diagnostics.filter((item) => /(?:LIMIT_REACHED|TOO_MANY|TOO_LARGE|TRUNCATED|COMPACTED)/.test(item.code));
  const incompleteRoutes = project.diagnostics.some((item) => item.code.includes('UNRESOLVED') || item.code === 'EXPRESS_ROUTE_PATH_INCOMPLETE');
  const parsePercentage = isV2 ? project.coverage.percentage : project.metrics.parseSuccessRate;
  const stored = isV2 ? project.completeness : undefined;
  const manifestStatus = isV2 ? project.inventory.manifestInventory?.status : project.metadata.manifestInventory?.status;
  const unsupported = isV2 ? project.inventory.sourceInventory?.unsupportedSourceFileCount ?? 0 : project.metadata.sourceInventory?.unsupportedSourceFileCount ?? 0;
  const unprocessed = isV2 ? project.inventory.sourceOutcomes?.unprocessed ?? 0 : project.metadata.sourceOutcomes?.unprocessed ?? 0;
  const reasons = [...new Set([
    ...(stored?.reasons ?? []), ...truncation, ...limitDiagnostics.map((item) => item.code),
    ...(limitNotices.length ? ['SOURCE_EXTRACTION_LIMIT_REACHED'] : []),
    ...(unresolved ? [`${unresolved} unresolved or ambiguous relationships`] : []),
    ...(scope?.kind === 'compacted' ? ['GRAPH_COMPACTED', ...(unresolved === null ? ['whole-analysis resolution-gap count unknown'] : [])] : []),
    ...(partial ? [`${partial} partially extracted files`] : []),
    ...(failed ? [`${failed} failed files`] : []),
    ...(parsePercentage < 100 ? [`parse coverage ${parsePercentage}%`] : []),
    ...(incompleteRoutes ? ['unresolved routes or mounts'] : []),
    ...(manifestStatus === 'partial' ? ['manifest dependency inventory is partial'] : []),
    ...(unsupported ? [`${unsupported} unsupported source files`] : []),
    ...(unprocessed ? [`${unprocessed} supported source files were not processed`] : []),
  ])];
  let status: CompletenessStatus;
  if (scope?.kind === 'compacted' || stored?.status === 'COVERAGE_LIMITED' || truncation.length || limitNotices.length || limitDiagnostics.length) status = 'COVERAGE_LIMITED';
  else if (stored?.status === 'PARTIAL' || partial || failed || unsupported || unprocessed || manifestStatus === 'partial' || parsePercentage < 100) status = 'PARTIAL';
  else if (stored?.status === 'MOSTLY_MAPPED' || unresolved || incompleteRoutes || reasons.length) status = 'MOSTLY_MAPPED';
  else status = 'FULLY_MAPPED';
  return { status, reasons, unresolvedCount: unresolved, retainedUnresolvedCount: scope?.retained.unresolvedRelationships ?? unresolved, partialFileCount: partial, failedFileCount: failed, label: COMPLETENESS_LABELS[status] };
}
