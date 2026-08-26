import { analyzeJavaScript } from './analyzers/javascript';
import { analyzePython } from './analyzers/python';
import { analyzePythonTreeSitter } from './analyzers/python-treesitter';
import { analyzeTreeSitter } from './analyzers/tree-sitter';
import { environmentEvidence, fingerprint, languageFor, parseTsconfigPaths } from './detection';
import { resolveExpressRouteMounts } from './express';
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
import { extractFromFileList, extractFromZip, fetchGitHubRepo, parseGitHubUrl, type ParsedGitHubUrl } from './ingestion';
export { parseGitHubUrl, type ParsedGitHubUrl };
import { DEFAULT_INGESTION_LIMITS, type IngestionLimits } from './types';
import type {
  Diagnostic,
  DiscoveredFile,
  FileRecord,
  PartialAnalysis,
  RepoDNAProject,
  TechnologyBoundary,
} from './types';

export type ParserMode = 'legacy' | 'tree-sitter';

export type AnalyzeProgressStage = 'parse' | 'resolve_relationships' | 'analytics';

export interface AnalyzeProgress {
  stage: AnalyzeProgressStage;
  completed: number;
  total: number;
  message: string;
}

export interface AnalyzeOptions {
  parserMode?: ParserMode;
  ingestionLimits?: IngestionLimits;
  /** Called at bounded checkpoints so long analyses can report real progress. */
  onProgress?: (progress: AnalyzeProgress) => void | Promise<void>;
  /** Defaults to roughly 50 parse updates for a repository of any size. */
  progressEvery?: number;
}

export function resolveParserMode(options?: AnalyzeOptions): ParserMode {
  if (options?.parserMode) return options.parserMode;
  if (typeof process !== 'undefined' && process.env?.REPODNA_PARSER_MODE === 'legacy') {
    return 'legacy';
  }
  return 'tree-sitter';
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
  const ingestionLimits = options?.ingestionLimits ?? DEFAULT_INGESTION_LIMITS;
  const progressEvery = Math.max(
    1,
    Math.floor(options?.progressEvery ?? Math.max(25, Math.ceil(Math.max(discoveredFiles.length, 1) / 50)))
  );
  const reportProgress = async (progress: AnalyzeProgress): Promise<void> => {
    await options?.onProgress?.(progress);
  };
  const yieldToEventLoop = async (): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  };

  await reportProgress({
    stage: 'parse',
    completed: 0,
    total: discoveredFiles.length,
    message: `Preparing to parse ${discoveredFiles.length.toLocaleString()} discovered files`,
  });

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

  for (let index = 0; index < discoveredFiles.length; index += 1) {
    const discovered = discoveredFiles[index];
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
    const ext = discovered.path.slice(discovered.path.lastIndexOf('.')).toLowerCase();
    const isTreeSitterMode = parserMode === 'tree-sitter';
    const isSupportedTreeSitter = ['.py', '.pyi', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.go'].includes(ext);
    if (isTreeSitterMode && isSupportedTreeSitter) {
      // Tree-sitter is default for Python/JS/TS/TSX/Go (spec phase 4). Falls back to legacy inside analyzer on failure.
      if (ext === '.py' || ext === '.pyi') {
        partial = await analyzePythonTreeSitter(discovered);
        // If python tree-sitter failed, it already fell back; but if still failed try generic
        if (partial.parseMeta?.quality === 'failed' && !partial.parserNotice) {
          try { partial = await analyzeTreeSitter(discovered); } catch {}
        }
      } else {
        partial = await analyzeTreeSitter(discovered);
      }
    } else if (discovered.path.endsWith('.py') || discovered.path.endsWith('.pyi')) {
      partial = analyzePython(discovered);
    } else if (['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'].some((e) => discovered.path.endsWith(e))) {
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

    const completed = index + 1;
    if (completed === discoveredFiles.length || completed % progressEvery === 0) {
      await reportProgress({
        stage: 'parse',
        completed,
        total: discoveredFiles.length,
        message: `Parsed ${completed.toLocaleString()} of ${discoveredFiles.length.toLocaleString()} discovered files`,
      });
      // Tree-sitter and the relationship builders are intentionally kept
      // single-threaded for deterministic output. Yield between batches so a
      // long scan does not monopolize the worker or server event loop.
      if (completed < discoveredFiles.length) await yieldToEventLoop();
    }
  }

  // Apply manifest entrypoint indicators
  applyManifestEntrypoints(partials, discoveredFiles);

  const symbols = partials.flatMap((p) => p.symbols);
  const imports = partials.flatMap((p) => p.imports);
  const calls = partials.flatMap((p) => p.calls);
  let routes = partials.flatMap((p) => p.routes);

  await reportProgress({
    stage: 'resolve_relationships',
    completed: 0,
    total: 4,
    message: `Resolving ${imports.length.toLocaleString()} import relationships`,
  });
  resolveImports(imports, files, pathAliases);
  await reportProgress({
    stage: 'resolve_relationships',
    completed: 1,
    total: 4,
    message: `Resolved imports; composing ${routes.length.toLocaleString()} detected routes`,
  });
  routes = resolveExpressRouteMounts(partials, imports, diagnostics);
  resolveCalls(calls, symbols, imports);
  await reportProgress({
    stage: 'resolve_relationships',
    completed: 2,
    total: 4,
    message: `Resolved ${calls.length.toLocaleString()} call relationships`,
  });

  const entrypoints = rankEntrypoints(files, partials);
  const { architecture, fileComponents } = buildArchitecture(files, symbols, imports, routes);
  await reportProgress({
    stage: 'resolve_relationships',
    completed: 3,
    total: 4,
    message: `Built ${architecture.components.length.toLocaleString()} architecture layers`,
  });
  const flows = buildFlows(routes, calls, symbols);
  const importantFiles = rankImportantFiles(files, imports, routes, entrypoints);
  const onboarding = onboardingTour(entrypoints, architecture, importantFiles);
  const metrics = graphMetrics(files, imports, symbols);
  await reportProgress({
    stage: 'resolve_relationships',
    completed: 4,
    total: 4,
    message: 'Relationship resolution complete',
  });

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
  const sourceCount = files.filter((f) => ['Python', 'JavaScript', 'TypeScript', 'Go'].includes(f.language)).length;

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
        maxFiles: ingestionLimits.maxFiles,
        maxFileBytes: ingestionLimits.maxFileBytes,
        maxArchiveBytes: ingestionLimits.maxArchiveBytes,
        maxTotalExtractedBytes: ingestionLimits.maxTotalExtractedBytes,
        fetchTimeoutMs: ingestionLimits.fetchTimeoutMs,
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
