import type { FileRecord } from '../types';
import { isCandidate, isGeneratedPath, isIgnored, isSourcePath, isSupportedSource } from './source-policy';

export interface SourcePathCounts {
  classificationVersion: 2;
  totalFileCount: number;
  firstPartySourceFileCount: number;
  supportedSourceFileCount: number;
  unsupportedSourceFileCount: number;
  evidenceFileCount: number;
  otherFileCount: number;
  ignoredFileCount: number;
  generatedFileCount: number;
  candidateFileCount: number;
  skippedSupportedSourceFileCount: number;
}
export interface SourceOutcomes {
  supported: number;
  complete: number;
  partial: number;
  failed: number;
  skipped: number;
  unprocessed: number;
}
export function classifySourcePaths(paths: string[], skipped: { path: string }[] = []): SourcePathCounts {
  const result: SourcePathCounts = { classificationVersion: 2, totalFileCount: 0, firstPartySourceFileCount: 0, supportedSourceFileCount: 0, unsupportedSourceFileCount: 0, evidenceFileCount: 0, otherFileCount: 0, ignoredFileCount: 0, generatedFileCount: 0, candidateFileCount: 0, skippedSupportedSourceFileCount: 0 };
  const supported = new Set<string>();
  for (const path of new Set(paths)) {
    result.totalFileCount++;
    if (isIgnored(path)) { result.ignoredFileCount++; continue; }
    if (isGeneratedPath(path)) { result.generatedFileCount++; continue; }
    if (isCandidate(path)) result.candidateFileCount++;
    if (isSupportedSource(path)) { result.supportedSourceFileCount++; result.firstPartySourceFileCount++; supported.add(path); }
    else if (isSourcePath(path)) { result.unsupportedSourceFileCount++; result.firstPartySourceFileCount++; }
    else if (isCandidate(path)) result.evidenceFileCount++;
    else result.otherFileCount++;
  }
  result.skippedSupportedSourceFileCount = new Set(skipped.filter((item) => supported.has(item.path)).map((item) => item.path)).size;
  return result;
}
export function acquisitionSourceCounts(inventory: Partial<SourcePathCounts> | undefined, paths: string[], skipped: { path: string }[]): SourcePathCounts {
  const fallback = classifySourcePaths(paths, skipped);
  const keys = Object.keys(fallback) as (keyof SourcePathCounts)[];
  if (inventory?.classificationVersion === 2 && keys.every((key) => Number.isSafeInteger(inventory[key]) && inventory[key]! >= 0)) {
    return Object.fromEntries(keys.map((key) => [key, inventory[key]])) as unknown as SourcePathCounts;
  }
  return fallback;
}
export function reconcileSourceOutcomes(files: FileRecord[], counts: SourcePathCounts): SourceOutcomes {
  const supported = files.filter((file) => isSupportedSource(file.path) && !isIgnored(file.path) && !isGeneratedPath(file.path));
  const partial = supported.filter((file) => file.parsed && file.error).length;
  const complete = supported.filter((file) => file.parsed && !file.error).length;
  const failed = supported.filter((file) => !file.parsed && file.error).length;
  const skipped = counts.skippedSupportedSourceFileCount;
  return { supported: counts.supportedSourceFileCount, complete, partial, failed, skipped, unprocessed: Math.max(0, counts.supportedSourceFileCount - complete - partial - failed - skipped) };
}
