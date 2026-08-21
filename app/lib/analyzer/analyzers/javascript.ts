import type { DiscoveredFile, PartialAnalysis, SymbolRecord } from '../types';

const IMPORT_RE = /(?:import\s+([\s\S]*?)\s+from\s+|import\s*\(|require\s*\()["']([^"']+)["']/g;
const EXPORT_RE = /^\s*export\s+(?:default\s+)?/;
const CLASS_RE = /\bclass\s+([a-zA-Z_$][\w$]*)/g;
const FUNCTION_RE = /(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)\s*\(|(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>/g;
const INTERFACE_RE = /\binterface\s+([a-zA-Z_$][\w$]*)/g;
const TYPE_RE = /\btype\s+([a-zA-Z_$][\w$]*)\s*=/g;
const EXPRESS_ROUTE_RE = /\b(?:app|router)\.(get|post|put|patch|delete|options|head|all)\s*\(\s*["']([^"']+)["']\s*,\s*([a-zA-Z_$][\w$]*)?/gi;
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
      names: parseBindings(bindings),
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

  // 4. Express Routes
  EXPRESS_ROUTE_RE.lastIndex = 0;
  let expMatch: RegExpExecArray | null;
  while ((expMatch = EXPRESS_ROUTE_RE.exec(source)) !== null) {
    const line = getLineNumber(source, expMatch.index);
    const method = expMatch[1].toUpperCase();
    const routePath = expMatch[2];
    const handlerName = expMatch[3] || `anonymous@${line}`;
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

  // 5. NestJS Controller Routes
  const nestController = NEST_CONTROLLER_RE.exec(source);
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
