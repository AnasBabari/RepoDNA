import { describe, expect, it } from 'vitest';
import { analyzeRepositoryFiles } from '../../app/lib/analyzer';
import { validateRepoDNAProject } from '../../app/lib/schema/validator';
import { readFixtureFiles } from '../helpers/fixtures';

function discoveryFor(fixtureDir: string) {
  return {
    name: fixtureDir.split('/').pop()!,
    source: `test:${fixtureDir}`,
    skipped: [],
    files: readFixtureFiles(fixtureDir),
  };
}

const routeKey = (r: { method: string; path: string; framework: string }) => `${r.method} ${r.path} ${r.framework}`;
const symbolKey = (s: { file: string; type: string; name: string }) => `${s.file}|${s.type}|${s.name}`;
const importKey = (i: { module: string; names: string[] }) => `${i.module}::${[...i.names].sort().join(',')}`;

describe('Tree-sitter migration pipeline', () => {
  it('analyzes fastapi-basic with tree-sitter enabled and passes schema validation', async () => {
    const result = await analyzeRepositoryFiles(discoveryFor('tests/fixtures/fastapi-basic'), {
      parserMode: 'tree-sitter',
    });

    const validation = validateRepoDNAProject(result);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);

    expect(result.metadata.analysisMode).toBe('static-typescript-tree-sitter');
    expect(result.repository.parsedFileCount).toBe(result.repository.sourceFileCount);
    expect(result.metrics.parseSuccessRate).toBe(100);
    expect(result.diagnostics.some((d) => d.code.startsWith('SOURCE_PARSE_'))).toBe(false);
  });

  it('keeps legacy mode untouched by default', async () => {
    const discovery = discoveryFor('tests/fixtures/fastapi-basic');
    const result = await analyzeRepositoryFiles(discovery);
    expect(result.metadata.analysisMode).toBe('static-typescript');
  });

  it('reports partial parse quality and diagnostics for malformed python', async () => {
    const discovery = discoveryFor('tests/fixtures/fastapi-basic');
    discovery.files.push({
      path: 'broken.py',
      size: 12,
      hash: 'hash_broken',
      content: 'def hello(\n',
    });

    const result = await analyzeRepositoryFiles(discovery, { parserMode: 'tree-sitter' });

    const broken = result.files.find((f) => f.path === 'broken.py');
    expect(broken?.parsed).toBe(true);

    const diagnostic = result.diagnostics.find((d) => d.code === 'SOURCE_PARSE_PARTIAL' && d.file === 'broken.py');
    expect(diagnostic?.severity).toBe('warning');
    expect(result.metrics.parseSuccessRate).toBe(100);
  });
});

describe('Legacy vs Tree-sitter differential suite', () => {
  const FIXTURES = ['tests/fixtures/fastapi-basic', 'tests/fixtures/mixed-basic'];

  for (const fixture of FIXTURES) {
    it(`keeps structural parity on ${fixture}`, async () => {
      const discovery = discoveryFor(fixture);
      const legacy = await analyzeRepositoryFiles(discovery, { parserMode: 'legacy' });
      const next = await analyzeRepositoryFiles(discovery, { parserMode: 'tree-sitter' });

      const pyFiles = new Set(
        discovery.files.filter((f) => f.path.endsWith('.py') || f.path.endsWith('.pyi')).map((f) => f.path)
      );

      const legacySymbols = legacy.symbols.filter((s) => pyFiles.has(s.file));
      const nextSymbols = next.symbols.filter((s) => pyFiles.has(s.file));

      const legacyKeys = new Set(legacySymbols.map(symbolKey));
      const nextKeys = new Set(nextSymbols.map(symbolKey));
      for (const key of legacyKeys) {
        expect(nextKeys.has(key)).toBe(true);
      }

      expect(next.routes.map(routeKey).sort()).toEqual(legacy.routes.map(routeKey).sort());

      const legacyImports = new Set(
        legacy.imports.filter((i) => pyFiles.has(i.source)).map(importKey)
      );
      const nextImports = new Set(next.imports.filter((i) => pyFiles.has(i.source)).map(importKey));
      for (const key of legacyImports) {
        expect(nextImports.has(key)).toBe(true);
      }

      const nextFrameworkSet = new Set(next.technologies);
      for (const tech of legacy.technologies) {
        if (['FastAPI', 'Flask', 'Django'].includes(tech)) {
          expect(nextFrameworkSet.has(tech)).toBe(true);
        }
      }
    });

    it(`captures improvements over the regex engine on ${fixture}`, async () => {
      const discovery = discoveryFor(fixture);
      const legacy = await analyzeRepositoryFiles(discovery, { parserMode: 'legacy' });
      const next = await analyzeRepositoryFiles(discovery, { parserMode: 'tree-sitter' });

      const pyFiles = new Set(
        discovery.files.filter((f) => f.path.endsWith('.py') || f.path.endsWith('.pyi')).map((f) => f.path)
      );

      const nextPyImports = next.imports.filter((i) => pyFiles.has(i.source));
      const relativeImports = nextPyImports.filter((i) => i.module.startsWith('.'));

      if (fixture.endsWith('mixed-basic')) {
        expect(relativeImports.length).toBe(4);

        const legacyRelative = legacy.imports.filter((i) => pyFiles.has(i.source) && i.module.startsWith('.'));
        expect(legacyRelative.length).toBe(relativeImports.length);

        const userRepoSave = next.symbols.find((s) => s.name === 'save' && s.type === 'method');
        expect(userRepoSave?.end_line).toBeDefined();
        expect(userRepoSave?.parent).toContain('UserRepository');
      }

      for (const symbol of next.symbols.filter((s) => pyFiles.has(s.file))) {
        if (symbol.type !== 'module') {
          expect(symbol.end_line ?? null).not.toBeNull();
        }
      }
    });
  }
});
