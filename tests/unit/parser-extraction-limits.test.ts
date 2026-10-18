import { describe, expect, it } from 'vitest';
import { getSyntaxParser } from '../../app/lib/analyzer/parser/registry';
import { EXTRACTION_LIMITS, extractionNotices, retainFact, visitAstNode } from '../../app/lib/analyzer/parser/extraction-budget';
import type { ExtractionLimit, SupportedLanguage } from '../../app/lib/analyzer/parser/types';
import { analyzeRepositoryV2 } from '../../app/lib/analyzer/v2/pipeline';

const languages: SupportedLanguage[] = ['python', 'javascript', 'typescript', 'tsx', 'go'];
function source(language: SupportedLanguage, category: 'symbols' | 'imports' | 'calls', count: number) {
  const rows = Array.from({ length: count }, (_, index) => {
    if (category === 'symbols') return language === 'python' ? `def f${index}():\n    pass` : language === 'go' ? `func F${index}() {}` : `function f${index}() {}`;
    if (category === 'imports') return language === 'python' ? `import mod${index}` : language === 'go' ? `import "mod${index}"` : `import 'mod${index}';`;
    return language === 'python' || language === 'go' ? 'target()' : 'target();';
  }).join('\n');
  return language === 'go' ? `package p\n${category === 'calls' ? `func TestCalls(){\n${rows}\n}` : rows}` : rows;
}

describe.each(languages)('%s extraction bounds', (language) => {
  for (const category of ['symbols', 'imports', 'calls'] as const) {
    for (const offset of [-1, 0, 1]) {
      it(`${category}: reports omission only above the ${EXTRACTION_LIMITS[category]} cap (${offset})`, async () => {
        const parser = (await getSyntaxParser(language))!;
        const { facts } = await parser.parse({ source: source(language, category, EXTRACTION_LIMITS[category] + offset) });
        expect(facts.parse.hasErrors).toBe(false);
        expect(facts[category]).toHaveLength(EXTRACTION_LIMITS[category] + Math.min(offset, 0));
        expect(facts.quality).toBe(offset > 0 ? 'partial' : 'complete');
        expect(facts.extractionLimits ?? []).toEqual(offset > 0 ? [expect.objectContaining({ category, limit: EXTRACTION_LIMITS[category], omittedCount: 1, countIsLowerBound: false })] : []);
      });
    }
  }
  it('reports valid but depth-bounded traversal separately from syntax errors', async () => {
    const expression = '('.repeat(150) + '1' + ')'.repeat(150);
    const text = language === 'go' ? `package p\nvar x = ${expression}` : `x = ${expression}`;
    const { facts } = await (await getSyntaxParser(language))!.parse({ source: text });
    expect(facts.parse.hasErrors).toBe(false);
    expect(facts.quality).toBe('partial');
    expect(facts.extractionLimits).toContainEqual(expect.objectContaining({ category: 'ast_depth', limit: 128, omittedCount: null, countIsLowerBound: true }));
  });
  it('reports the AST node budget without inventing omitted-fact totals', async () => {
    const body = (language === 'python' ? 'x + x\n' : 'x = x + x;\n').repeat(10000);
    const text = language === 'go' ? `package p\nfunc Nodes(){\n${body}\n}` : body;
    const { facts } = await (await getSyntaxParser(language))!.parse({ source: text });
    expect(facts.quality).toBe('partial');
    expect(facts.extractionLimits).toContainEqual(expect.objectContaining({ category: 'ast_nodes', limit: 25000, omittedCount: null, countIsLowerBound: true }));
  });
});

it('enforces exact AST and fact boundaries in the common budget implementation', () => {
  const range = { startLine: 1, endLine: 1, startColumn: 0, endColumn: 1 };
  const state = { symbols: [] as unknown[], imports: [], calls: [], nodeCount: 24999, extractionLimits: [] as ExtractionLimit[] };
  expect(visitAstNode(state, 128, range)).toBe(true);
  expect(state.extractionLimits).toEqual([]);
  expect(visitAstNode(state, 128, range)).toBe(false);
  expect(visitAstNode(state, 129, range)).toBe(false);
  state.symbols = new Array(1000);
  expect(retainFact(state, 'symbols', range)).toBe(false);
  expect(extractionNotices(state).every((notice) => notice.countIsLowerBound)).toBe(true);
});

it('retains file/category/cap provenance and partial status through the canonical pipeline', async () => {
  const text = source('python', 'symbols', 1005);
  const result = await analyzeRepositoryV2({ files: [{ path: 'large.py', content: text, size: text.length, hash: 'fixture', language: 'Python' }], skipped: [], name: 'bounded', source: 'local://fixture' }, { parserMode: 'tree-sitter' });
  expect(result.completeness.status).toBe('COVERAGE_LIMITED');
  expect(result.inventory.partiallyParsedFileCount).toBe(1);
  expect(result.inventory.failedFileCount).toBe(0);
  expect(result.inventory.extractionLimits).toEqual([expect.objectContaining({ file: 'large.py', category: 'symbols', limit: 1000, omittedCount: 5 })]);
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ file: 'large.py', code: 'SOURCE_EXTRACTION_LIMIT_REACHED', message: expect.stringContaining('limit 1000; omitted 5 symbols') }));
  expect(result.diagnostics.some((notice) => notice.code === 'SOURCE_PARSE_PARTIAL')).toBe(false);
});
