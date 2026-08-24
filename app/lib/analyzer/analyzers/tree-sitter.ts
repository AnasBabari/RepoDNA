import type { DiscoveredFile, PartialAnalysis } from '../types';
import { getSyntaxParser, languageForPath } from '../parser/registry';
import type { SyntaxCall, SyntaxImport, SyntaxSymbol } from '../parser/types';
import { ParserError } from '../parser/types';
import { analyzeJavaScript } from './javascript';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all', 'websocket']);

const EXTERNALS: Record<string, string> = {
  stripe: 'Stripe', redis: 'Redis', ioredis: 'Redis',
  '@aws-sdk': 'AWS', 'aws-sdk': 'AWS', openai: 'OpenAI',
  '@anthropic-ai': 'Anthropic', '@supabase': 'Supabase',
  firebase: 'Firebase', 'firebase-admin': 'Firebase',
  kafkajs: 'Kafka', amqplib: 'RabbitMQ',
  '@sendgrid': 'SendGrid', resend: 'Resend', twilio: 'Twilio',
  mongodb: 'MongoDB', mongoose: 'MongoDB',
};

const FRAMEWORKS_JS: Record<string, string> = {
  react: 'React', next: 'Next.js', express: 'Express',
  '@nestjs/core': 'NestJS', '@nestjs/common': 'NestJS',
  vue: 'Vue', nuxt: 'Nuxt', svelte: 'Svelte',
  hono: 'Hono', fastify: 'Fastify', koa: 'Koa',
};

const DATABASES_JS: Record<string, string> = {
  '@prisma/client': 'Prisma', prisma: 'Prisma', 'drizzle-orm': 'Drizzle ORM',
  typeorm: 'TypeORM', pg: 'PostgreSQL', postgres: 'PostgreSQL',
  mysql: 'MySQL', mysql2: 'MySQL', 'better-sqlite3': 'SQLite',
  mongoose: 'MongoDB', mongodb: 'MongoDB',
};

function getModuleRoot(mod: string): string {
  if (mod.startsWith('@')) {
    const parts = mod.split('/');
    return parts.length > 1 ? `${parts[0]}/${parts[1]}` : mod;
  }
  return mod.split('/')[0];
}

export async function analyzeTreeSitter(file: DiscoveredFile): Promise<PartialAnalysis> {
  const language = languageForPath(file.path);
  if (!language) {
    // Fallback to legacy for unsupported
    if (['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'].some((ext) => file.path.endsWith(ext))) {
      return analyzeJavaScript(file);
    }
    return emptyPartial(file);
  }

  try {
    const parser = await getSyntaxParser(language);
    if (!parser) throw new ParserError('UNSUPPORTED_LANGUAGE', `No parser for ${file.path}`);
    const { facts } = await parser.parse({ source: file.content });
    return buildPartialAnalysis(file, facts.language, facts.symbols, facts.imports, facts.calls, facts.quality, facts.parse.errorNodes);
  } catch (error) {
    // Fallback to legacy for JS/TS
    if (['javascript', 'typescript', 'tsx'].includes(language)) {
      const fallback = analyzeJavaScript(file);
      if (error instanceof ParserError) {
        fallback.parserNotice = { code: error.code, message: error.message };
      } else {
        fallback.parserNotice = { code: 'TREE_SITTER_INIT_FAILED', message: `Tree-sitter failed; legacy used for ${file.path}` };
      }
      return fallback;
    }
    if (error instanceof ParserError) {
      const p = emptyPartial(file);
      p.parserNotice = { code: error.code, message: error.message };
      p.file.parsed = false;
      p.file.error = error.code;
      return p;
    }
    const p = emptyPartial(file);
    p.parserNotice = { code: 'TREE_SITTER_INIT_FAILED', message: `Tree-sitter failed unexpectedly for ${file.path}` };
    return p;
  }
}

function emptyPartial(file: DiscoveredFile): PartialAnalysis {
  const lines = file.content.split(/\r?\n/).length;
  return {
    file: {
      id: `file:${file.path}`,
      path: file.path,
      language: languageLabel(file.path),
      lines,
      bytes: file.size,
      hash: file.hash,
      role: 'source',
      parsed: false,
      error: null,
    },
    symbols: [
      { id: file.path, type: 'module', name: file.path.split('/').pop()!, file: file.path, line: 1, end_line: lines, parent: null, exported: false, evidence: [] },
    ],
    imports: [],
    calls: [],
    routes: [],
    frameworks: new Set(),
    databases: new Set(),
    externals: new Set(),
    entrypointEvidence: [],
    parseMeta: { quality: 'failed', errorNodes: 0 },
  };
}

function languageLabel(path: string): string {
  if (path.endsWith('.go')) return 'Go';
  if (path.endsWith('.tsx')) return 'TypeScript';
  if (path.endsWith('.ts')) return 'TypeScript';
  if (['.js', '.jsx', '.mjs', '.cjs'].some((e) => path.endsWith(e))) return 'JavaScript';
  if (path.endsWith('.py') || path.endsWith('.pyi')) return 'Python';
  return 'Configuration';
}

function buildPartialAnalysis(
  file: DiscoveredFile,
  language: string,
  symbols: SyntaxSymbol[],
  imports: SyntaxImport[],
  calls: SyntaxCall[],
  quality: 'complete' | 'partial' | 'failed',
  errorNodes: number
): PartialAnalysis {
  const lines = file.content.split(/\r?\n/).length;
  const result: PartialAnalysis = {
    file: {
      id: `file:${file.path}`,
      path: file.path,
      language: languageLabel(file.path),
      lines,
      bytes: file.size,
      hash: file.hash,
      role: 'source',
      parsed: quality === 'complete' || quality === 'partial',
      error: quality === 'failed' ? 'TREE_SITTER returned no tree' : null,
    },
    symbols: [
      { id: file.path, type: 'module', name: file.path.split('/').pop()!, file: file.path, line: 1, end_line: lines, parent: null, exported: false, evidence: [] },
    ],
    imports: [],
    calls: [],
    routes: [],
    frameworks: new Set(),
    databases: new Set(),
    externals: new Set(),
    entrypointEvidence: [],
    expressMounts: [],
    parseMeta: { quality, errorNodes },
  };

  // Symbols
  for (const sym of symbols) {
    const type: string = sym.kind;
    if (sym.kind === 'class' && sym.bases?.some((b) => b.includes('Controller'))) {
      result.frameworks.add('NestJS');
    }
    result.symbols.push({
      id: `${file.path}::${sym.qualifiedName}`,
      type,
      name: sym.name,
      file: file.path,
      line: sym.range.startLine,
      end_line: sym.range.endLine,
      parent: sym.parent ? `${file.path}::${sym.parent}` : null,
      exported: sym.exported,
      evidence: sym.decorators?.map((d) => `@${d.name}`) ?? [],
    });
  }

  // Imports
  for (const imp of imports) {
    result.imports.push({
      id: `${file.path}:import:${imp.range.startLine}:${imp.module}`,
      source: file.path,
      module: imp.module,
      names: [...imp.names],
      line: imp.range.startLine,
      target: null,
      external: false,
    });
    const root = getModuleRoot(imp.module);
    for (const [prefix, name] of Object.entries(EXTERNALS)) if (root === prefix || root.startsWith(prefix + '/')) result.externals.add(name);
    for (const [prefix, name] of Object.entries(FRAMEWORKS_JS)) if (root === prefix || root.startsWith(prefix + '/')) result.frameworks.add(name);
    for (const [prefix, name] of Object.entries(DATABASES_JS)) if (root === prefix || root.startsWith(prefix + '/')) result.databases.add(name);
    if (language === 'go') {
      // Go framework detection via import path
      if (imp.module.includes('gin-gonic/gin')) result.frameworks.add('Gin');
      if (imp.module.includes('labstack/echo')) result.frameworks.add('Echo');
      if (imp.module.includes('gorilla/mux')) result.frameworks.add('gorilla/mux');
      if (imp.module.includes('gorm.io/gorm')) { result.frameworks.add('GORM'); result.databases.add('SQL database'); }
      if (imp.module.includes('database/sql')) result.databases.add('SQL database');
    }
  }

  // Calls
  for (const call of calls) {
    const ownerId = call.ownerQualifiedName ? `${file.path}::${call.ownerQualifiedName}` : file.path;
    result.calls.push({
      id: `${ownerId}:call:${call.range.startLine}:${call.callee}`,
      source: ownerId,
      callee: call.callee,
      file: file.path,
      line: call.range.startLine,
      target: null,
      confidence: 0.55,
    });
    // Framework heuristics from calls
    if (call.callee.includes('FastAPI') || call.callee.includes('APIRouter')) result.frameworks.add('FastAPI');
    if (call.callee.includes('Flask')) result.frameworks.add('Flask');
    if (call.callee === 'express' || call.callee.includes('Router')) result.frameworks.add('Express');
  }

  // Routes — language specific
  if (['javascript', 'typescript', 'tsx'].includes(language)) {
    extractJsRoutes(file, symbols, result);
    // Express mount extraction for prefix composition (mirrors legacy javascript.ts)
    result.expressMounts = extractExpressMountsForTreeSitter(file);
  } else if (language === 'go') {
    extractGoRoutes(file, symbols, calls, result);
  } else if (language === 'python') {
    extractPythonRoutes(symbols, result, file);
  }

  // Entrypoint evidence
  const filename = file.path.split('/').pop()!;
  if (['index.js', 'index.ts', 'server.js', 'server.ts', 'main.js', 'main.ts', 'main.tsx', 'main.go', 'app.go'].includes(filename)) {
    result.entrypointEvidence.push(`uses a conventional ${filename} entrypoint filename`);
  }
  if (file.content.includes('app.listen(') || file.content.includes('server.listen(') || file.content.includes('http.ListenAndServe')) {
    result.entrypointEvidence.push('starts an HTTP listener');
  }

  return result;
}

function extractJsRoutes(file: DiscoveredFile, symbols: SyntaxSymbol[], result: PartialAnalysis): void {
  const source = file.content;
  const EXPRESS_ROUTE_RE = /\b([a-zA-Z_$][\w$]*)\.(get|post|put|patch|delete|options|head|all)\s*\(\s*["']([^"']+)["']\s*,\s*([a-zA-Z_$][\w$]*)?/gi;
  const NEST_CONTROLLER_RE = /@Controller\s*\(\s*["']([^"']*)["']\s*\)/;
  const NEST_ROUTE_RE = /@(Get|Post|Put|Patch|Delete|Options|Head|All)\s*\(\s*(?:["']([^"']*)["'])?\s*\)\s*\n\s*(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\(/gi;

  // Express
  const receivers = new Set(['app', 'router']);
  const receiverRe = /\b(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:express\s*\(|(?:express\.)?Router\s*\()/g;
  let m: RegExpExecArray | null;
  while ((m = receiverRe.exec(source)) !== null) receivers.add(m[1]);

  let expMatch: RegExpExecArray | null;
  EXPRESS_ROUTE_RE.lastIndex = 0;
  while ((expMatch = EXPRESS_ROUTE_RE.exec(source)) !== null) {
    if (!receivers.has(expMatch[1])) continue;
    const line = (source.slice(0, expMatch.index).match(/\n/g) || []).length + 1;
    const method = expMatch[2].toUpperCase();
    const path = expMatch[3];
    const handler = expMatch[4] || `anonymous@${line}`;
    result.routes.push({
      id: `route:${file.path}:${line}:${method}:${path}`,
      method,
      path,
      handler: `${file.path}::${handler}`,
      file: file.path,
      line,
      framework: 'Express',
      confidence: 0.96,
    });
    result.frameworks.add('Express');
  }

  // NestJS
  const nestController = NEST_CONTROLLER_RE.exec(source);
  if (nestController) {
    result.frameworks.add('NestJS');
    let prefix = nestController[1] || '';
    prefix = prefix ? '/' + prefix.replace(/^\/+|\/+$/g, '') : '';
    NEST_ROUTE_RE.lastIndex = 0;
    let nMatch: RegExpExecArray | null;
    while ((nMatch = NEST_ROUTE_RE.exec(source)) !== null) {
      const line = (source.slice(0, nMatch.index).match(/\n/g) || []).length + 1;
      const method = nMatch[1].toUpperCase();
      let sub = nMatch[2] || '';
      sub = sub ? '/' + sub.replace(/^\/+|\/+$/g, '') : '';
      const full = `${prefix}${sub}` || '/';
      const handler = nMatch[3] || `handler@${line}`;
      result.routes.push({
        id: `route:${file.path}:${line}:${method}:${full}`,
        method,
        path: full,
        handler: `${file.path}::${handler}`,
        file: file.path,
        line,
        framework: 'NestJS',
        confidence: 0.95,
      });
    }
  }

  // Next.js App Router
  const parts = file.path.split('/');
  const filename = parts[parts.length - 1];
  if (['route.ts', 'route.js', 'route.tsx', 'route.jsx'].includes(filename) && parts.includes('app')) {
    const methodMatches = Array.from(source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g));
    for (const mm of methodMatches) {
      const method = mm[1];
      const line = (source.slice(0, mm.index).match(/\n/g) || []).length + 1;
      const appIndex = parts.indexOf('app');
      const segs = parts.slice(appIndex + 1, -1).filter((p) => !(p.startsWith('(') && p.endsWith(')')));
      const rp = '/' + segs.join('/');
      result.routes.push({ id: `route:${file.path}:${line}:${method}:${rp || '/'}`, method, path: rp || '/', handler: `${file.path}::${method}`, file: file.path, line, framework: 'Next.js', confidence: 0.94 });
      result.frameworks.add('Next.js');
    }
  }
  if (parts.includes('pages') && parts.includes('api')) {
    const apiIndex = parts.indexOf('api');
    const segs = parts.slice(apiIndex + 1);
    if (segs.length > 0) {
      const last = segs[segs.length - 1].replace(/\.[a-zA-Z]+$/, '');
      segs[segs.length - 1] = last;
    }
    const clean = segs.filter((p) => p !== 'index');
    const rp = '/api/' + clean.join('/');
    result.routes.push({ id: `route:${file.path}:1:ANY:${rp.replace(/\/+$/, '') || '/api'}`, method: 'ANY', path: rp.replace(/\/+$/, '') || '/api', handler: `${file.path}::default`, file: file.path, line: 1, framework: 'Next.js', confidence: 0.9 });
    result.frameworks.add('Next.js');
  }

  // Also check for symbols that are decorated with Nest decorators
  for (const sym of symbols) {
    for (const dec of sym.decorators) {
      const meth = dec.name.split('.').pop()?.toLowerCase();
      if (!meth || !HTTP_METHODS.has(meth)) continue;
      const args = dec.argumentsText ?? '';
      const pathMatch = args.match(/["']([^"']+)["']/);
      if (!pathMatch) continue;
      const full = '/' + pathMatch[1].replace(/^\/+/, '');
      result.routes.push({
        id: `route:${file.path}:${sym.range.startLine}:${meth.toUpperCase()}:${full}`,
        method: meth.toUpperCase(),
        path: full,
        handler: `${file.path}::${sym.qualifiedName}`,
        file: file.path,
        line: sym.range.startLine,
        framework: 'NestJS',
        confidence: 0.94,
      });
      result.frameworks.add('NestJS');
    }
  }
}

const EXPRESS_MOUNT_RE = /\b([a-zA-Z_$][\w$]*)\.use\s*\(/g;
const EXPRESS_RECEIVER_RE = /\b(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:express\s*\(|(?:express\.)?Router\s*\()/g;

function collectExpressReceivers(source: string): Set<string> {
  const receivers = new Set(['app', 'router']);
  EXPRESS_RECEIVER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXPRESS_RECEIVER_RE.exec(source)) !== null) receivers.add(match[1]);
  return receivers;
}
function readCallArguments(source: string, openParen: number): string[] | null {
  const args: string[] = [];
  let start = openParen + 1;
  let parenDepth = 1;
  let braceDepth = 0;
  let bracketDepth = 0;
  let quote: "'" | '"' | '`' | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openParen + 1; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; index++; } continue; }
    if (quote) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === quote) quote = null; continue; }
    if (char === '/' && next === '/') { lineComment = true; index++; continue; }
    if (char === '/' && next === '*') { blockComment = true; index++; continue; }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '(') parenDepth++;
    else if (char === ')') { parenDepth--; if (parenDepth === 0) { const finalArg = source.slice(start, index).trim(); if (finalArg || args.length > 0) args.push(finalArg); return args; } }
    else if (char === '{') braceDepth++;
    else if (char === '}') braceDepth--;
    else if (char === '[') bracketDepth++;
    else if (char === ']') bracketDepth--;
    else if (char === ',' && parenDepth === 1 && braceDepth === 0 && bracketDepth === 0) { args.push(source.slice(start, index).trim()); start = index + 1; }
  }
  return null;
}
function staticStringValue(expression: string): string | null {
  const value = expression.trim();
  if (value.length < 2) return null;
  const quote = value[0];
  if (!['"', "'", '`'].includes(quote) || value.at(-1) !== quote) return null;
  if (quote === '`' && value.includes('${')) return null;
  return value.slice(1, -1).replace(/\\([\\'"`])/g, '$1');
}
function directRequireModule(expression: string): string | null {
  return expression.match(/^require\s*\(\s*["']([^"']+)["']\s*\)$/)?.[1] ?? null;
}
function extractExpressMountsForTreeSitter(file: DiscoveredFile): import('../types').ExpressMountRecord[] {
  const source = file.content;
  const receivers = collectExpressReceivers(source);
  const mounts: import('../types').ExpressMountRecord[] = [];
  EXPRESS_MOUNT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXPRESS_MOUNT_RE.exec(source)) !== null) {
    const receiver = match[1];
    if (!receivers.has(receiver)) continue;
    const openParen = source.indexOf('(', match.index);
    const args = readCallArguments(source, openParen);
    if (!args?.length) continue;
    const staticPrefix = staticStringValue(args[0]);
    const hasExplicitPrefix = staticPrefix !== null;
    const targetExpression = args[hasExplicitPrefix ? args.length - 1 : args.length === 1 ? 0 : args.length - 1].trim();
    const targetIdentifier = /^[a-zA-Z_$][\w$]*$/.test(targetExpression) ? targetExpression : null;
    const targetModule = directRequireModule(targetExpression);
    const prefixExpression = hasExplicitPrefix ? args[0].trim() : args.length > 1 ? args[0].trim() : null;
    const prefix = hasExplicitPrefix ? staticPrefix : args.length === 1 ? '/' : null;
    const line = (source.slice(0, match.index).match(/\n/g) || []).length + 1;
    mounts.push({ id: `express-mount:${file.path}:${line}:${mounts.length}`, file: file.path, line, receiver, prefix, prefixExpression, targetIdentifier, targetModule, targetExpression, dynamic: prefix === null || (!targetIdentifier && !targetModule) });
  }
  return mounts;
}

function extractGoRoutes(file: DiscoveredFile, symbols: SyntaxSymbol[], calls: SyntaxCall[], result: PartialAnalysis): void {
  const source = file.content;
  // net/http: http.HandleFunc("/path", handler), http.Handle("/path", ...)
  const handleRe = /\b(?:http\.HandleFunc|http\.Handle)\s*\(\s*["']([^"']+)["']\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = handleRe.exec(source)) !== null) {
    const line = (source.slice(0, m.index).match(/\n/g) || []).length + 1;
    const path = m[1];
    // Try to find handler name as second arg
    const rest = source.slice(m.index + m[0].length);
    const handlerMatch = rest.match(/^\s*([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)/);
    const handler = handlerMatch ? handlerMatch[1] : `handler@${line}`;
    result.routes.push({ id: `route:${file.path}:${line}:ANY:${path}`, method: 'ANY', path, handler: `${file.path}::${handler}`, file: file.path, line, framework: 'net/http', confidence: 0.88 });
    result.frameworks.add('net/http');
  }
  // Gin/Echo: r.GET("/path", handler), e.POST, router.Handle, etc. with method as function name
  const ginRe = /\b(\w+)\.(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|Any|Handle)\s*\(\s*["']([^"']+)["']/g;
  while ((m = ginRe.exec(source)) !== null) {
    const line = (source.slice(0, m.index).match(/\n/g) || []).length + 1;
    const method = m[2].toUpperCase() === 'ANY' ? 'ANY' : m[2].toUpperCase();
    const path = m[3];
    // Skip if not a known router variable; heuristic: check calls for gin.New etc.
    // But we still add with lower confidence
    result.routes.push({ id: `route:${file.path}:${line}:${method}:${path}`, method, path, handler: `${file.path}::handler@${line}`, file: file.path, line, framework: 'Gin/Echo', confidence: 0.82 });
    if (!result.frameworks.has('Gin') && !result.frameworks.has('Echo')) result.frameworks.add('Gin');
  }
  // Gorilla mux: r.HandleFunc("/path", handler).Methods("GET", "POST")
  const muxRe = /\.HandleFunc\s*\(\s*["']([^"']+)["']/g;
  while ((m = muxRe.exec(source)) !== null) {
    const line = (source.slice(0, m.index).match(/\n/g) || []).length + 1;
    const path = m[1];
    // Look ahead for Methods
    const ahead = source.slice(m.index, m.index + 200);
    const methodMatch = ahead.match(/\.Methods\s*\(\s*["']([^"']+)["']/);
    const method = methodMatch ? methodMatch[1].toUpperCase() : 'ANY';
    if (!result.routes.some((r) => r.path === path && r.line === line)) {
      result.routes.push({ id: `route:${file.path}:${line}:${method}:${path}`, method, path, handler: `${file.path}::handler@${line}`, file: file.path, line, framework: 'gorilla/mux', confidence: 0.84 });
      result.frameworks.add('gorilla/mux');
    }
  }
  // Also consider symbols that look like handlers: func Handler(w http.ResponseWriter, r *http.Request)
  for (const sym of symbols) {
    if (sym.kind === 'function' && file.content.includes(`func ${sym.name}(`) && file.content.includes('http.ResponseWriter')) {
      // already captured via calls? Add entrypoint evidence
      result.entrypointEvidence.push(`defines HTTP handler ${sym.name}`);
    }
  }
}

function extractPythonRoutes(symbols: SyntaxSymbol[], result: PartialAnalysis, file: DiscoveredFile): void {
  // Reuse python-treesitter route logic: check decorators for FastAPI/Flask/Django
  const HTTP_METHODS_PY = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'websocket']);
  for (const sym of symbols) {
    if (sym.kind !== 'function' && sym.kind !== 'method') continue;
    for (const dec of sym.decorators) {
      const parts = dec.name.split('.');
      const meth = parts.pop()?.toLowerCase();
      if (!meth || !HTTP_METHODS_PY.has(meth) && meth !== 'route') continue;
      const args = dec.argumentsText ?? '';
      const pathMatch = args.match(/["']([^"']+)["']/);
      if (!pathMatch) continue;
      let method = meth.toUpperCase();
      let framework = 'FastAPI';
      if (meth === 'route') { framework = 'Flask'; method = 'GET'; const methodsMatch = args.match(/methods\s*=\s*\[([\s\S]*?)\]/); if (methodsMatch) { const parsed = methodsMatch[1].split(',').map((p) => p.replace(/['"\s]/g, '').toUpperCase()).filter(Boolean); method = parsed.join(',') || 'GET'; } }
      const raw = pathMatch[1];
      const full = '/' + raw.replace(/^\/+/, '');
      result.routes.push({ id: `route:${file.path}:${sym.range.startLine}:${method}:${full}`, method, path: full, handler: `${file.path}::${sym.qualifiedName}`, file: file.path, line: sym.range.startLine, framework, confidence: 0.98 });
      result.frameworks.add(framework);
    }
  }
}
