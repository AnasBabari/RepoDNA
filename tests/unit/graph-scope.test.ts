import { beforeAll, expect, it } from 'vitest';
import { analyzeRepositoryV2 } from '../../app/lib/analyzer/v2/pipeline';
import type { RepoDNAProjectV2 } from '../../app/lib/analyzer/v2/types';
import { graphCounts, resolveGraphScope } from '../../app/lib/graph-scope';
import { analysisQuality } from '../../app/lib/analysis-quality';
import { validateRepoDNAProjectV2 } from '../../app/lib/schema/safe-validator';

const files = Array.from({ length: 6 }, (_, index) => {
  const content = Array.from({ length: 20 }, (_, n) => `def f${n}():\n    return unknown${n}()`).join('\n');
  return { path: `src/module${index}.py`, content, size: content.length, hash: `scope${index}`, language: 'Python' };
});
const discovery = { files, skipped: [], name: 'scope', source: 'local://scope' };
let full: RepoDNAProjectV2;
let bounded: RepoDNAProjectV2;
beforeAll(async () => {
  full = await analyzeRepositoryV2(discovery, { parserMode: 'tree-sitter', graphLimits: { maxNodes: 5000, maxEdges: 5000 } });
  bounded = await analyzeRepositoryV2(discovery, { parserMode: 'tree-sitter', graphLimits: { maxNodes: 5000, maxEdges: 1 } });
});

it('preserves whole-analysis gaps when the retained graph has none', () => {
  const scope = resolveGraphScope(bounded);
  expect(scope.kind).toBe('compacted');
  expect(scope.original).toEqual(graphCounts(full));
  expect(scope.retained).toEqual(graphCounts(bounded));
  expect(scope.original.unresolvedRelationships).toBe(120);
  expect(scope.retained.unresolvedRelationships).toBe(0);
  expect(scope.omitted.unresolvedRelationships).toBe(120);
  expect(scope.omitted.relationships).toBe(full.edges.length - 1);
  expect(scope.analyticsScope).toBe('retained-subgraph');
  expect(analysisQuality(bounded)).toMatchObject({ status: 'COVERAGE_LIMITED', unresolvedCount: 120, retainedUnresolvedCount: 0 });
  expect(validateRepoDNAProjectV2(bounded).errors).toEqual([]);
});

it('retains bounded node counts while preserving original extraction totals', async () => {
  const smaller = await analyzeRepositoryV2(discovery, { parserMode: 'tree-sitter', graphLimits: { maxNodes: 5, maxEdges: 1 } });
  expect(smaller.nodes).toHaveLength(5);
  expect(smaller.edges.length).toBeLessThanOrEqual(1);
  expect(smaller.graphScope?.original).toEqual(graphCounts(full));
  expect(smaller.graphScope?.omitted.nodes).toBe(full.nodes.length - 5);
});

it('labels uncompacted facts without implying runtime completeness', () => {
  expect(resolveGraphScope(full)).toMatchObject({ kind: 'uncompacted', original: graphCounts(full), retained: graphCounts(full), analyticsScope: 'uncompacted-extracted-graph' });
  expect(resolveGraphScope(full).omitted).toEqual({ nodes: 0, relationships: 0, unresolvedRelationships: 0, ambiguousRelationships: 0 });
});

it('does not invent original totals for legacy compacted artifacts or inconsistent counts', () => {
  const old = structuredClone(bounded);
  delete old.graphScope;
  expect(resolveGraphScope(old).original).toEqual({ nodes: null, relationships: null, unresolvedRelationships: null, ambiguousRelationships: null });
  expect(analysisQuality(old).unresolvedCount).toBeNull();
  old.graphScope = structuredClone(bounded.graphScope!);
  old.graphScope.original.nodes = 0;
  expect(resolveGraphScope(old).original.nodes).toBeNull();
});
