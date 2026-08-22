import { analyzeJavaScript } from './analyzers/javascript';
import { analyzePython } from './analyzers/python';
import { analyzePythonTreeSitter } from './analyzers/python-treesitter';
import { environmentEvidence, fingerprint, languageFor, parseTsconfigPaths } from './detection';
import {
  buildArchitecture,
  buildFlows,
  graphMetrics,
  onboardingTour,
  rankEntrypoints,
  rankImportantFiles,
  resolveCalls,
  resolveImports,
} from './graph';
import { extractFromFileList, extractFromZip, fetchGitHubRepo } from './ingestion';
import type {
  Diagnostic,
  DiscoveredFile,
  FileRecord,
  PartialAnalysis,
  RepoDNAProject,
  TechnologyBoundary,
} from './types';

export type ParserMode = 'legacy' | 'tree-sitter';

export interface AnalyzeOptions {
  parserMode?: ParserMode;
}

export function resolveParserMode(options?: AnalyzeOptions): ParserMode {
  if (options?.parserMode) return options.parserMode;
  if (typeof process !== 'undefined' && process.env?.REPODNA_PARSER_MODE === 'tree-sitter') {
    return 'tree-sitter';
  }
  return 'legacy';
}

export async function analyzeRepositoryFiles(
  discovery: {
    files: DiscoveredFile[];
    skipped: { path: string; reason: string }[];
    name: string;
    source: string;
  },
  options?: AnalyzeOptions
): Promise<RepoDNAProject> {
  const { files: discoveredFiles, skipped, name, source } = discovery;
  const parserMode = resolveParserMode(options);

  const fingerprintData = fingerprint(discoveredFiles);
  const pathAliases = parseTsconfigPaths(discoveredFiles);

  const files: FileRecord[] = [];
  const partials: PartialAnalysis[] = [];
  const diagnostics: Diagnostic[] = skipped.map((item) => ({
    severity: 'info',
    code: `skipped_${item.reason}`,
    message: `Skipped ${item.path}: ${item.reason}`,
    file: item.path === '*' ? null : item.path,
  }));

  for (const discovered of discoveredFiles) {
    const lang = languageFor(discovered.path);
    const lineCount = (discovered.content.match(/\n/g) || []).length + 1;

    const fileRec: FileRecord = {
      id: `file:${discovered.path}`,
      path: discovered.path,
      language: lang,
      lines: lineCount,
      bytes: discovered.size,
      hash: discovered.hash,
      role: 'source',
      parsed: false,
      error: null,
    };

    files.push(fileRec);

    let partial: PartialAnalysis;
    if (discovered.path.endsWith('.py') || discovered.path.endsWith('.pyi')) {
      partial =
        parserMode === 'tree-sitter'
          ? await analyzePythonTreeSitter(discovered)
          : analyzePython(discovered);
    } else if (['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'].some((ext) => discovered.path.endsWith(ext))) {
      partial = analyzeJavaScript(discovered);
    } else {
      partial = {
        file: fileRec,
        symbols: [],
        imports: [],
        calls: [],
        routes: [],
        frameworks: new Set(),
        databases: new Set(),
        externals: new Set(),
        entrypointEvidence: [],
      };
    }

    partials.push(partial);
    fileRec.parsed = partial.file.parsed;
    fileRec.error = partial.file.error;
    if (partial.parserNotice) {
      diagnostics.push({
        severity: 'warning',
        code: partial.parserNotice.code,
        message: partial.parserNotice.message,
        file: partial.file.path,
      });
    } else if (partial.parseMeta?.quality === 'partial') {
      diagnostics.push({
        severity: 'warning',
        code: 'SOURCE_PARSE_PARTIAL',
        message: `Python source contained syntax errors and was partially analyzed.`,
        file: partial.file.path,
      });
    } else if (partial.parseMeta?.quality === 'failed') {
      diagnostics.push({
        severity: 'warning',
        code: 'SOURCE_PARSE_FAILED',
        message: `Python source could not be parsed and was skipped from syntax analysis.`,
        file: partial.file.path,
      });
    }
    if (partial.file.error && !partial.parserNotice) {
      diagnostics.push({
        severity: 'warning',
        code: 'parse_error',
        message: partial.file.error,
        file: partial.file.path,
      });
    }
  }

  // Apply manifest entrypoint indicators
  applyManifestEntrypoints(partials, discoveredFiles);

  const symbols = partials.flatMap((p) => p.symbols);
  const imports = partials.flatMap((p) => p.imports);
  const calls = partials.flatMap((p) => p.calls);
  const routes = partials.flatMap((p) => p.routes);

  resolveImports(imports, files, pathAliases);
  resolveCalls(calls, symbols, imports);

  const entrypoints = rankEntrypoints(files, partials);
  const { architecture, fileComponents } = buildArchitecture(files, symbols, imports, routes);
  const flows = buildFlows(routes, calls, symbols);
  const importantFiles = rankImportantFiles(files, imports, routes, entrypoints);
  const onboarding = onboardingTour(entrypoints, architecture, importantFiles);
  const metrics = graphMetrics(files, imports, symbols);

  const environment = environmentEvidence(discoveredFiles);
  const frameworks = new Set(fingerprintData.frameworks);
  const databases = new Set(fingerprintData.databases);
  const externals = new Set(fingerprintData.externalSystems);

  for (const partial of partials) {
    partial.frameworks.forEach((f) => frameworks.add(f));
    partial.databases.forEach((d) => databases.add(d));
    partial.externals.forEach((e) => externals.add(e));
  }

  for (const f of discoveredFiles) {
    if (f.path.toLowerCase().endsWith('.sql') || /\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i.test(f.content)) {
      databases.add('SQL database');
    }
  }

  for (const envName of Object.keys(environment)) {
    if (['PostgreSQL', 'MongoDB', 'Supabase'].includes(envName)) {
      databases.add(envName);
    } else {
      externals.add(envName);
    }
  }

  if (databases.has('SQL database') && (databases.has('PostgreSQL') || databases.has('MySQL') || databases.has('SQLite'))) {
    databases.delete('SQL database');
  }

  const languageLines: Record<string, number> = {};
  for (const file of files) {
    if (file.language !== 'Configuration' && file.language !== 'Markdown') {
      languageLines[file.language] = (languageLines[file.language] ?? 0) + file.lines;
    }
  }
  const totalLangLines = Object.values(languageLines).reduce((a, b) => a + b, 0) || 1;
  const languagePercentages: Record<string, number> = {};
  for (const [lang, lcount] of Object.entries(languageLines)) {
    languagePercentages[lang] = Math.round((lcount / totalLangLines) * 1000) / 10;
  }

  const technologies = Array.from(new Set([
    ...frameworks,
    ...databases,
    ...externals,
    ...fingerprintData.infrastructure,
    ...fingerprintData.testing,
    ...fingerprintData.buildTools,
  ])).sort();

  const parsedCount = files.filter((f) => f.parsed).length;
  const sourceCount = files.filter((f) => ['Python', 'JavaScript', 'TypeScript'].includes(f.language)).length;

  const dbRecords: TechnologyBoundary[] = Array.from(databases).sort().map((dName) => ({
    name: dName,
    type: 'database',
    confidence: environment[dName]?.length ? 0.95 : 0.72,
    evidence: (environment[dName] || []).slice(0, 20),
  }));

  const extRecords: TechnologyBoundary[] = Array.from(externals).sort().map((eName) => ({
    name: eName,
    type: 'external_system',
    confidence: environment[eName]?.length ? 0.95 : 0.72,
    evidence: (environment[eName] || []).slice(0, 20),
  }));

  return {
    schemaVersion: '1.1.0',
    generatedAt: new Date().toISOString(),
    repository: {
      name,
      source,
      languages: languagePercentages,
      fileCount: files.length,
      sourceFileCount: sourceCount,
      parsedFileCount: parsedCount,
      lines: files.reduce((acc, f) => acc + f.lines, 0),
      fingerprint: fingerprintData,
    },
    technologies,
    files,
    symbols,
    imports,
    calls,
    routes,
    databases: dbRecords,
    externalSystems: extRecords,
    external_systems: extRecords,
    entrypoints,
    flows,
    architecture,
    importantFiles,
    important_files: importantFiles,
    onboarding,
    metrics: {
      ...metrics,
      symbols: symbols.length,
      routes: routes.length,
      components: architecture.components.length,
      parseSuccessRate: sourceCount ? Math.round((parsedCount / sourceCount) * 1000) / 10 : 100.0,
    },
    diagnostics,
    metadata: {
      analysisMode: parserMode === 'tree-sitter' ? 'static-typescript-tree-sitter' : 'static-typescript',
      executedRepositoryCode: false,
      analyzerVersion: '1.2.0',
      limits: {
        maxFiles: 10000,
        maxFileBytes: 1000000,
        maxArchiveBytes: 25 * 1024 * 1024,
        maxTotalExtractedBytes: 100 * 1024 * 1024,
      },
      fileComponents,
      cache: { hits: 0, misses: files.length },
    },
  };
}

function applyManifestEntrypoints(partials: PartialAnalysis[], files: DiscoveredFile[]) {
  const byFile = new Map(partials.map((p) => [p.file.path, p]));
  const available = new Set(byFile.keys());

  for (const f of files) {
    const filename = f.path.split('/').pop()!;
    const candidates: [candidate: string, reason: string][] = [];

    if (filename === 'package.json') {
      try {
        const pkg = JSON.parse(f.content);
        if (typeof pkg.main === 'string') candidates.push([pkg.main, 'package main points here']);
        if (typeof pkg.module === 'string') candidates.push([pkg.module, 'package module points here']);
        if (pkg.scripts && typeof pkg.scripts === 'object') {
          for (const sname of ['start', 'dev', 'serve']) {
            const cmd = pkg.scripts[sname];
            if (typeof cmd === 'string') {
              const match = cmd.match(/([a-zA-Z0-9_./-]+\.(?:py|js|mjs|cjs|ts|tsx|jsx))/);
              if (match) candidates.push([match[1], `package ${sname} script starts this file`]);
            }
          }
        }
      } catch {}
    } else if (filename === 'Dockerfile') {
      const match = f.content.match(/([a-zA-Z0-9_./-]+\.(?:py|js|mjs|cjs|ts|tsx|jsx))/);
      if (match) candidates.push([match[1], 'Docker CMD or ENTRYPOINT references this file']);
    }

    for (const [candidate, reason] of candidates) {
      const resolved = resolveManifestTarget(f.path, candidate, available);
      if (resolved && byFile.has(resolved)) {
        const partial = byFile.get(resolved)!;
        if (!partial.entrypointEvidence.includes(reason)) {
          partial.entrypointEvidence.push(reason);
        }
      }
    }
  }
}

function resolveManifestTarget(manifestPath: string, candidate: string, available: Set<string>): string | null {
  const parentParts = manifestPath.split('/');
  parentParts.pop();
  const cleaned = candidate.replace(/^['"]|['"]$/g, '').replace(/^\.?\//, '');
  const joined = parentParts.length > 0 ? `${parentParts.join('/')}/${cleaned}` : cleaned;
  const candidates = [joined];

  if (!joined.includes('.')) {
    candidates.push(
      ...['.js', '.ts', '.tsx', '.py'].map((ext) => joined + ext),
      ...['.js', '.ts', '.tsx'].map((ext) => `${joined}/index${ext}`)
    );
  }
  return candidates.find((p) => available.has(p)) ?? null;
}

export async function analyzeGitHubUrl(
  url: string,
  limits?: import('./types').IngestionLimits,
  accessToken?: string,
  options?: AnalyzeOptions
): Promise<RepoDNAProject> {
  const discovery = await fetchGitHubRepo(url, limits, accessToken);
  return analyzeRepositoryFiles(discovery, options);
}

export async function analyzeUploadedFiles(
  files: FileList | File[],
  limits?: import('./types').IngestionLimits,
  options?: AnalyzeOptions
): Promise<RepoDNAProject> {
  const discovery = await extractFromFileList(files, limits);
  return analyzeRepositoryFiles(discovery, options);
}

export async function analyzeZipBuffer(
  buffer: ArrayBuffer | Uint8Array,
  name = 'uploaded-repo',
  limits?: import('./types').IngestionLimits,
  options?: AnalyzeOptions
): Promise<RepoDNAProject> {
  const discovery = await extractFromZip(buffer, name, limits);
  return analyzeRepositoryFiles({ ...discovery, source: `upload:zip:${name}` }, options);
}
