import type { ExtractionLimit, ExtractionLimitCategory, SourceRange } from './types';

export const EXTRACTION_LIMITS = {
  symbols: 1000,
  imports: 500,
  calls: 2000,
  ast_nodes: 25000,
  ast_depth: 128,
} as const;

interface BudgetState {
  symbols: unknown[];
  imports: unknown[];
  calls: unknown[];
  nodeCount: number;
  extractionLimits: ExtractionLimit[];
}

function recordLimit(state: BudgetState, category: ExtractionLimitCategory, range: SourceRange) {
  const existing = state.extractionLimits.find((notice) => notice.category === category);
  if (existing) {
    if (existing.omittedCount !== null) existing.omittedCount += 1;
    return;
  }
  state.extractionLimits.push({
    category, limit: EXTRACTION_LIMITS[category], range,
    omittedCount: category.startsWith('ast_') ? null : 1,
    countIsLowerBound: category.startsWith('ast_'),
  });
}

export function retainFact(state: BudgetState, category: 'symbols' | 'imports' | 'calls', range: SourceRange): boolean {
  if (state[category].length < EXTRACTION_LIMITS[category]) return true;
  recordLimit(state, category, range);
  return false;
}

export function visitAstNode(state: BudgetState, depth: number, range: SourceRange): boolean {
  if (depth > EXTRACTION_LIMITS.ast_depth) {
    recordLimit(state, 'ast_depth', range);
    return false;
  }
  if (state.nodeCount >= EXTRACTION_LIMITS.ast_nodes) {
    recordLimit(state, 'ast_nodes', range);
    return false;
  }
  state.nodeCount += 1;
  return true;
}

export function extractionNotices(state: BudgetState): ExtractionLimit[] {
  const traversalLimited = state.extractionLimits.some((notice) => notice.category.startsWith('ast_'));
  return state.extractionLimits.map((notice) => ({
    ...notice, countIsLowerBound: notice.countIsLowerBound || traversalLimited,
  })).sort((left, right) => left.category.localeCompare(right.category));
}
