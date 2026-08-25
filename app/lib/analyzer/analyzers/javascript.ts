import type { DiscoveredFile, ExpressMountRecord, PartialAnalysis, SymbolRecord } from '../types';
import { isTestFile } from '../detection';

const IMPORT_RE = /(?:import\s+([\s\S]*?)\s+from\s+|import\s*\(|require\s*\()["']([^"']+)["']/g;
const EXPORT_RE = /^\s*export\s+(?:default\s+)?/;
const CLASS_RE = /\bclass\s+([a-zA-Z_$][\w$]*)/g;
const FUNCTION_RE = /(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)\s*\(|(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>/g;
const INTERFACE_RE = /\binterface\s+([a-zA-Z_$][\w$]*)/g;
const TYPE_RE = /\btype\s+([a-zA-Z_$][\w$]*)\s*=/g;
const EXPRESS_ROUTE_RE = /\b([a-zA-Z_$][\w$]*)\.(get|post|put|patch|delete|options|head|all)\s*\(\s*["']([^"']+)["']\s*,\s*([a-zA-Z_$][\w$]*)?/gi;
const EXPRESS_RECEIVER_RE = /\b(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:express\s*\(|(?:express\.)?Router\s*\()/g;
const EXPRESS_MOUNT_RE = /\b([a-zA-Z_$][\w$]*)\.use\s*\(/g;
const NEST_CONTROLLER_RE = /@Controller\s*\(\s*["']([^"']*)["']\s*\)/;
const NEST_ROUTE_RE = /@(Get|Post|Put|Patch|Delete|Options|Head|All)\s*\(\s*(?:["']([^"']*)["'])?\s*\)\s*\n\s*(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\(/gi;
const CALL_RE = /\b([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)\s*\(/g;

const EXTERNALS: Record<string, string> = {
  stripe: 'Stripe', ioredis: 'Redis', redis: 'Redis',
  '@aws-sdk': 'AWS', 'aws-sdk': 'AWS', openai: 'OpenAI',
  '@anthropic-ai': 'Anthropic', '@supabase': 'Supabase',
  firebase: 'Firebase', kafkajs: 'Kafka', amqplib: 'RabbitMQ',
  '@sendgrid': 'SendGrid', resend: 'Resend', twilio: 'Twilio',
  mongodb: 'MongoDB', mongoose: 'MongoDB', graphql: 'GraphQL',
  '@apollo': 'GraphQL', '@grpc': 'gRPC',
};

const FRAMEWORKS: Record<string, string> = {
  react: 'React', next: 'Next.js', express: 'Express',
  '@nestjs': 'NestJS', vite: 'Vite', vitest: 'Vitest',
  playwright: 'Playwright', '@playwright': 'Playwright',
  vue: 'Vue', nuxt: 'Nuxt', svelte: 'Svelte', '@sveltejs': 'SvelteKit',
  astro: 'Astro', '@remix-run': 'Remix', hono: 'Hono', fastify: 'Fastify',
};

const DATABASES: Record<string, string> = {
  '@prisma': 'Prisma', prisma: 'Prisma', 'drizzle-orm': 'Drizzle ORM',
  typeorm: 'TypeORM', pg: 'PostgreSQL', postgres: 'PostgreSQL',
  mysql: 'MySQL', mysql2: 'MySQL', sqlite: 'SQLite', 'better-sqlite3': 'SQLite',
  mongodb: 'MongoDB', mongoose: 'MongoDB', '@supabase': 'Supabase',
};

function getLineNumber(source: string, offset: number): number {
  return (source.slice(0, offset).match(/\n/g) || []).length + 1;
}

function parseBindings(bindings?: string): string[] {
  if (!bindings) return [];
  const cleaned = bindings
    .replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\b(?:type|as|default)\b/g, ' ');
  const matches = cleaned.match(/[a-zA-Z_$][\w$]*/g) || [];
  return matches.filter((m) => m !== 'from' && m !== 'import');
}

function inferRequireBindings(source: string, matchIndex: number): string[] {
  const lineStart = source.lastIndexOf('\n', matchIndex) + 1;
  const prefix = source.slice(lineStart, matchIndex);
  const direct = prefix.match(/\b(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*$/);
  if (direct) return [direct[1]];

  const destructured = prefix.match(/\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*$/);
  if (!destructured) return [];
  return destructured[1]
    .split(',')
    .map((part) => part.trim().split(/\s*:\s*/).at(-1)?.trim() ?? '')
    .filter((name) => /^[a-zA-Z_$][\w$]*$/.test(name));
}

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

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index++;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index++;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') parenDepth++;
    else if (char === ')') {
      parenDepth--;
      if (parenDepth === 0) {
        const finalArg = source.slice(start, index).trim();
        if (finalArg || args.length > 0) args.push(finalArg);
        return args;
      }
    } else if (char === '{') braceDepth++;
    else if (char === '}') braceDepth--;
    else if (char === '[') bracketDepth++;
    else if (char === ']') bracketDepth--;
    else if (char === ',' && parenDepth === 1 && braceDepth === 0 && bracketDepth === 0) {
      args.push(source.slice(start, index).trim());
      start = index + 1;
    }
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

function extractExpressMounts(
  source: string,
  file: DiscoveredFile,
  receivers: Set<string>
): ExpressMountRecord[] {
  const mounts: ExpressMountRecord[] = [];
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
    const line = getLineNumber(source, match.index);

    mounts.push({
      id: `express-mount:${file.path}:${line}:${mounts.length}`,
      file: file.path,
      line,
      receiver,
      prefix,
      prefixExpression,
      targetIdentifier,
      targetModule,
      targetExpression,
      dynamic: prefix === null || (!targetIdentifier && !targetModule),
    });
  }
  return mounts;
}

function getModuleRoot(mod: string): string {
  if (mod.startsWith('@')) {
    const parts = mod.split('/');
    return parts.length > 1 ? `${parts[0]}/${parts[1]}` : mod;
  }
  return mod.split('/')[0];
}

export function analyzeJavaScript(file: DiscoveredFile): PartialAnalysis {
  const source = file.content;
  const lines = source.split(/\r?\n/);
  const lineCount = lines.length;
  const skipRoutes = isTestFile(file.path);

  const result: PartialAnalysis = {
    file: {
      id: `file:${file.path}`,
      path: file.path,
      language: file.path.endsWith('.ts') || file.path.endsWith('.tsx') ? 'TypeScript' : 'JavaScript',
      lines: lineCount,
      bytes: file.size,
      hash: file.hash,
      role: 'source',
      parsed: true,
      error: null,
    },
    symbols: [
      {
        id: file.path,
        type: 'module',
        name: file.path.split('/').pop()!,
        file: file.path,
        line: 1,
        end_line: lineCount,
        parent: null,
        exported: false,
        evidence: [],
      },
    ],
    imports: [],
    calls: [],
    routes: [],
    frameworks: new Set<string>(),
    databases: new Set<string>(),
    externals: new Set<string>(),
    entrypointEvidence: [],
    expressMounts: [],
  };

  // 1. Imports
  IMPORT_RE.lastIndex = 0;
  let impMatch: RegExpExecArray | null;
  while ((impMatch = IMPORT_RE.exec(source)) !== null) {
    const bindings = impMatch[1];
    const moduleName = impMatch[2];
    const line = getLineNumber(source, impMatch.index);

    result.imports.push({
      id: `${file.path}:import:${line}:${moduleName}`,
      source: file.path,
      module: moduleName,
      names: bindings ? parseBindings(bindings) : inferRequireBindings(source, impMatch.index),
      line,
      target: null,
      external: false,
    });

    const root = getModuleRoot(moduleName);
    for (const [prefix, name] of Object.entries(EXTERNALS)) {
      if (root === prefix || root.startsWith(prefix + '/')) result.externals.add(name);
    }
    for (const [prefix, name] of Object.entries(FRAMEWORKS)) {
      if (root === prefix || root.startsWith(prefix + '/')) result.frameworks.add(name);
    }
    for (const [prefix, name] of Object.entries(DATABASES)) {
      if (root === prefix || root.startsWith(prefix + '/')) result.databases.add(name);
    }
  }

  const symbolsByLine: SymbolRecord[] = [];

  // 2. Classes, Interfaces, Types
  for (const [regex, kind] of [[CLASS_RE, 'class'], [INTERFACE_RE, 'interface'], [TYPE_RE, 'type']] as const) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
      const line = getLineNumber(source, match.index);
      const name = match[1];
      const prevLineBreak = source.lastIndexOf('\n', match.index);
      const prefixText = source.slice(prevLineBreak + 1, match.index);
      const exported = EXPORT_RE.test(prefixText);

      const symbol: SymbolRecord = {
        id: `${file.path}::${name}`,
        type: kind,
        name,
        file: file.path,
        line,
        end_line: null,
        parent: null,
        exported,
        evidence: [],
      };
      result.symbols.push(symbol);
      symbolsByLine.push(symbol);
    }
  }

  // 3. Functions and Components
  FUNCTION_RE.lastIndex = 0;
  let funcMatch: RegExpExecArray | null;
  while ((funcMatch = FUNCTION_RE.exec(source)) !== null) {
    const line = getLineNumber(source, funcMatch.index);
    const name = funcMatch[1] || funcMatch[2];
    const isComponent = (file.path.endsWith('.jsx') || file.path.endsWith('.tsx')) && /^[A-Z]/.test(name);
    const kind = isComponent ? 'component' : 'function';
    const prevLineBreak = source.lastIndexOf('\n', funcMatch.index);
    const prefixText = source.slice(prevLineBreak + 1, funcMatch.index);
    const exported = EXPORT_RE.test(prefixText);

    const symbol: SymbolRecord = {
      id: `${file.path}::${name}`,
      type: kind,
      name,
      file: file.path,
      line,
      end_line: null,
      parent: null,
      exported,
      evidence: isComponent ? ['capitalized JSX/TSX function'] : [],
    };
    result.symbols.push(symbol);
    symbolsByLine.push(symbol);
  }

  symbolsByLine.sort((a, b) => a.line - b.line);

  // 4. Express Routes and router mounts
  const expressReceivers = collectExpressReceivers(source);
  EXPRESS_ROUTE_RE.lastIndex = 0;
  let expMatch: RegExpExecArray | null;
  while (!skipRoutes && (expMatch = EXPRESS_ROUTE_RE.exec(source)) !== null) {
    if (!expressReceivers.has(expMatch[1])) continue;
    const line = getLineNumber(source, expMatch.index);
    const method = expMatch[2].toUpperCase();
    const routePath = expMatch[3];
    const handlerName = expMatch[4] || `anonymous@${line}`;
    const matchedSymbol = symbolsByLine.find((s) => s.name === handlerName);
    const handlerId = matchedSymbol ? matchedSymbol.id : `${file.path}::${handlerName}`;

    result.frameworks.add('Express');
    result.routes.push({
      id: `route:${file.path}:${line}:${method}:${routePath}`,
      method,
      path: routePath,
      handler: handlerId,
      file: file.path,
      line,
      framework: 'Express',
      confidence: 0.96,
    });
  }
  result.expressMounts = extractExpressMounts(source, file, expressReceivers);

  // 5. NestJS Controller Routes
  const nestController = skipRoutes ? null : NEST_CONTROLLER_RE.exec(source);
  if (nestController) {
    result.frameworks.add('NestJS');
    let prefix = nestController[1] || '';
    prefix = prefix ? '/' + prefix.replace(/^\/+|\/+$/g, '') : '';

    NEST_ROUTE_RE.lastIndex = 0;
    let nMatch: RegExpExecArray | null;
    while ((nMatch = NEST_ROUTE_RE.exec(source)) !== null) {
      const line = getLineNumber(source, nMatch.index);
      const method = nMatch[1].toUpperCase();
      let subpath = nMatch[2] || '';
      subpath = subpath ? '/' + subpath.replace(/^\/+|\/+$/g, '') : '';
      const fullPath = `${prefix}${subpath}` || '/';
      const handlerName = nMatch[3] || `handler@${line}`;

      result.routes.push({
        id: `route:${file.path}:${line}:${method}:${fullPath}`,
        method,
        path: fullPath,
        handler: `${file.path}::${handlerName}`,
        file: file.path,
        line,
        framework: 'NestJS',
        confidence: 0.95,
      });
    }
  }

  // 6. Next.js App Router & Pages Router
  const pathParts = file.path.split('/');
  const filename = pathParts[pathParts.length - 1];

  if (['route.ts', 'route.js', 'route.tsx', 'route.jsx'].includes(filename) && pathParts.includes('app')) {
    const methodMatches = Array.from(source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g));
    for (const mMatch of methodMatches) {
      const method = mMatch[1];
      const line = getLineNumber(source, mMatch.index);
      const appIndex = pathParts.indexOf('app');
      const routeSegments = pathParts.slice(appIndex + 1, -1).filter((p) => !(p.startsWith('(') && p.endsWith(')')));
      const routePath = '/' + routeSegments.join('/');

      result.frameworks.add('Next.js');
      result.routes.push({
        id: `route:${file.path}:${line}:${method}:${routePath || '/'}`,
        method,
        path: routePath || '/',
        handler: `${file.path}::${method}`,
        file: file.path,
        line,
        framework: 'Next.js',
        confidence: 0.94,
      });
    }
  }

  if (pathParts.includes('pages') && pathParts.includes('api')) {
    const apiIndex = pathParts.indexOf('api');
    const routeSegments = pathParts.slice(apiIndex + 1);
    if (routeSegments.length > 0) {
      const last = routeSegments[routeSegments.length - 1].replace(/\.[a-zA-Z]+$/, '');
      routeSegments[routeSegments.length - 1] = last;
    }
    const cleanSegments = routeSegments.filter((p) => p !== 'index');
    const routePath = '/api/' + cleanSegments.join('/');
    const defaultExport = symbolsByLine.find((s) => s.exported);

    result.frameworks.add('Next.js');
    result.routes.push({
      id: `route:${file.path}:1:ANY:${routePath.replace(/\/+$/, '') || '/api'}`,
      method: 'ANY',
      path: routePath.replace(/\/+$/, '') || '/api',
      handler: defaultExport ? defaultExport.id : `${file.path}::default`,
      file: file.path,
      line: 1,
      framework: 'Next.js',
      confidence: 0.9,
    });
  }

  // 7. Function Calls
  CALL_RE.lastIndex = 0;
  let cMatch: RegExpExecArray | null;
  while ((cMatch = CALL_RE.exec(source)) !== null) {
    const line = getLineNumber(source, cMatch.index);
    const callee = cMatch[1];
    if (['if', 'for', 'while', 'switch', 'function', 'catch', 'return'].includes(callee)) continue;

    const sourceSymbol = symbolsByLine.slice().reverse().find((s) => s.line <= line);
    const sourceId = sourceSymbol ? sourceSymbol.id : file.path;

    result.calls.push({
      id: `${sourceId}:call:${line}:${callee}`,
      source: sourceId,
      callee,
      file: file.path,
      line,
      target: null,
      confidence: 0.55,
    });
  }

  // 8. Entrypoint evidence
  if (['index.js', 'index.ts', 'server.js', 'server.ts', 'main.js', 'main.ts', 'main.tsx'].includes(filename)) {
    result.entrypointEvidence.push(`uses a conventional ${filename} entrypoint filename`);
  }
  if (/\b(?:app|server)\.listen\s*\(/.test(source)) {
    result.entrypointEvidence.push('starts an HTTP listener');
  }
  if (source.includes('createRoot(') || source.includes('ReactDOM.render(') || source.includes('createApp(')) {
    result.frameworks.add(source.includes('createApp(') ? 'Vue' : 'React');
    result.entrypointEvidence.push('mounts a client application');
  }
  if (source.includes('createClient(') && source.toLowerCase().includes('supabase')) {
    result.externals.add('Supabase');
    result.databases.add('Supabase');
  }

  return result;
}
