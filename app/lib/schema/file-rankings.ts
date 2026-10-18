import type { GraphNode } from '../analyzer/v2/types';
import type { ImportantFile } from '../types';

type RankedNode = { nodeId: string; score: number; reasons: string[] };
const NON_FILE_LOCATIONS = new Set(['repository', 'workspace', 'package', 'directory', 'dependency', 'external_system']);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Repository-relative identity: preserve case and directories, never use basename. */
function fileIdentity(path: string): string | null {
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.includes('\0')) return null;
  const parts = normalized.split('/').filter((part) => part && part !== '.');
  return parts.length && !parts.includes('..') ? parts.join('/') : null;
}

/** Sum each distinct recorded node once; this is not a unique file-edge count. */
export function aggregateFileRankings(nodes: ReadonlyMap<string, GraphNode>, entries: RankedNode[]): ImportantFile[] {
  const uniqueNodes = new Map<string, { file: string; score: number; reasons: Set<string> }>();
  for (const entry of entries) {
    const node = nodes.get(entry.nodeId);
    if (!node || NON_FILE_LOCATIONS.has(node.kind) || !Number.isFinite(entry.score) || entry.score < 0) continue;
    const file = fileIdentity(node.path);
    if (!file) continue;
    const existing = uniqueNodes.get(entry.nodeId);
    const reasons = existing?.reasons ?? new Set<string>();
    for (const reason of entry.reasons) reasons.add(`${node.qualifiedName || node.name} (${node.kind}): ${reason}`);
    uniqueNodes.set(entry.nodeId, { file, score: Math.max(existing?.score ?? 0, entry.score), reasons });
  }
  const files = new Map<string, ImportantFile>();
  for (const [, item] of [...uniqueNodes].sort(([a], [b]) => compare(a, b))) {
    const file = files.get(item.file) ?? { file: item.file, score: 0, reasons: [] };
    file.score += item.score;
    file.reasons.push(...item.reasons);
    files.set(item.file, file);
  }
  return [...files.values()].map((file) => ({ ...file, reasons: [...new Set(file.reasons)].sort(compare) }))
    .sort((a, b) => b.score - a.score || compare(a.file, b.file));
}
