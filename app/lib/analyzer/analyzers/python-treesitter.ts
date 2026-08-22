import type { SyntaxDecorator, SyntaxSymbol } from '../parser/types';
import { ParserError } from '../parser/types';
import { getSyntaxParser, languageForPath } from '../parser/registry';
import { analyzePython } from './python';
import type { DiscoveredFile, PartialAnalysis } from '../types';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'websocket']);
const EXTERNALS: Record<string, string> = {
  stripe: 'Stripe', redis: 'Redis', boto3: 'AWS', openai: 'OpenAI',
  anthropic: 'Anthropic', supabase: 'Supabase', firebase_admin: 'Firebase',
  kafka: 'Kafka', aiokafka: 'Kafka', celery: 'Celery', pika: 'RabbitMQ',
  sendgrid: 'SendGrid', resend: 'Resend', twilio: 'Twilio', pymongo: 'MongoDB',
  motor: 'MongoDB', httpx: 'HTTPX', aiohttp: 'aiohttp',
};

export async function analyzePythonTreeSitter(file: DiscoveredFile): Promise<PartialAnalysis> {
  try {
    const language = languageForPath(file.path) ?? 'python';
    const parser = await getSyntaxParser(language);
    if (!parser) throw new ParserError('UNSUPPORTED_LANGUAGE', `No syntax parser registered for ${file.path}`);
    const { facts } = await parser.parse({ source: file.content });
    return buildPartialAnalysis(file, facts);
  } catch (error) {
    const partial = analyzePython(file);
    if (error instanceof ParserError) {
      partial.parserNotice = { code: error.code, message: error.message };
      if (error.code !== 'SOURCE_PARSE_PARTIAL') {
        partial.file.parsed = false;
        partial.file.error = error.code;
      }
    } else {
      partial.parserNotice = {
        code: 'TREE_SITTER_INIT_FAILED',
        message: `Tree-sitter analysis failed unexpectedly; legacy analysis was used for ${file.path}.`,
      };
    }
    return partial;
  }
}

function buildPartialAnalysis(file: DiscoveredFile, facts: import('../parser/types').SyntaxFacts): PartialAnalysis {
  const lineCount = file.content.split(/\r?\n/).length;

  const result: PartialAnalysis = {
    file: {
      id: `file:${file.path}`,
      path: file.path,
      language: 'Python',
      lines: lineCount,
      bytes: file.size,
      hash: file.hash,
      role: 'source',
      parsed: facts.quality === 'complete' || facts.quality === 'partial',
      error: facts.quality === 'failed' ? 'TREE_SITTER returned no syntax tree' : null,
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
    parseMeta: { quality: facts.quality, errorNodes: facts.parse.errorNodes },
  };

  extractSymbols(file, facts, result);
  extractRoutes(facts, result);
  extractImports(file, facts, result);
  extractCalls(file, facts, result);

  if (facts.hasMainGuard) {
    result.entrypointEvidence.push('contains a __main__ execution guard');
  }

  const lowered = file.content.toLowerCase();
  if (lowered.includes('postgresql://') || lowered.includes('postgres://')) {
    result.databases.add('PostgreSQL');
  }
  if (lowered.includes('mongodb://') || lowered.includes('mongodb+srv://')) {
    result.databases.add('MongoDB');
  }

  return result;
}

function symbolId(file: DiscoveredFile, symbol: SyntaxSymbol): string {
  return `${file.path}::${symbol.qualifiedName}`;
}

function extractSymbols(file: DiscoveredFile, facts: import('../parser/types').SyntaxFacts, result: PartialAnalysis): void {
  for (const symbol of facts.symbols) {
    let type: string = symbol.kind;
    const evidence: string[] = [];

    if (symbol.kind === 'class') {
      const bases = symbol.bases;
      const isModel =
        bases.some((b) =>
          b.endsWith('Base') ||
          b.endsWith('DeclarativeBase') ||
          b.includes('models.Model') ||
          b === 'Model' ||
          b.endsWith('Model') ||
          b === 'SQLModel' ||
          b.endsWith('Document')
        ) ?? false;

      if (isModel) {
        type = 'database_model';
        if (bases.some((b) => b.includes('models.Model'))) {
          evidence.push('inherits from Django Model');
          result.frameworks.add('Django');
          result.databases.add('Django ORM');
        } else if (bases.some((b) => b === 'SQLModel')) {
          evidence.push('inherits from SQLModel');
          result.frameworks.add('SQLModel');
          result.databases.add('SQL database');
        } else if (bases.some((b) => b.endsWith('Document'))) {
          evidence.push('inherits from Beanie/Mongo Document');
          result.databases.add('MongoDB');
        } else {
          evidence.push('inherits from an ORM model base');
          result.frameworks.add('SQLAlchemy');
          result.databases.add('SQL database');
        }
      }
    }

    result.symbols.push({
      id: symbolId(file, symbol),
      type,
      name: symbol.name,
      file: file.path,
      line: symbol.range.startLine,
      end_line: symbol.range.endLine,
      parent: symbol.parent ? `${file.path}::${symbol.parent}` : null,
      exported: symbol.exported,
      evidence,
    });
  }
}

function extractRoutes(facts: import('../parser/types').SyntaxFacts, result: PartialAnalysis): void {
  const routerPrefixes: Record<string, string> = {};
  for (const call of facts.calls) {
    if (!call.assignedTo || !call.argumentsText) continue;
    const isRouterFactory =
      call.callee === 'APIRouter' || call.callee.endsWith('.APIRouter') ||
      call.callee === 'Blueprint' || call.callee.endsWith('.Blueprint');
    if (!isRouterFactory) continue;
    const prefixMatch = call.argumentsText.match(/(?:prefix|url_prefix)\s*=\s*["']([^"']+)["']/);
    if (prefixMatch) routerPrefixes[call.assignedTo] = prefixMatch[1];
  }

  for (const symbol of facts.symbols) {
    if (symbol.kind !== 'function' && symbol.kind !== 'method') continue;
    if (symbol.decorators.length === 0) continue;

    const line = symbol.range.startLine;
    const qualifiedId = symbol.qualifiedName;

    for (const decorator of symbol.decorators) {
      const route = routeFromDecorator(decorator, routerPrefixes);
      if (!route) continue;

      const handlerId = `${result.file.path}::${qualifiedId}`;
      result.frameworks.add(route.framework);
      result.routes.push({
        id: `route:${result.file.path}:${line}:${route.method}:${route.fullPath}`,
        method: route.method,
        path: route.fullPath,
        handler: handlerId,
        file: result.file.path,
        line,
        framework: route.framework,
        confidence: 0.98,
      });
    }
  }
}

function routeFromDecorator(
  decorator: SyntaxDecorator,
  routerPrefixes: Record<string, string>
): { method: string; fullPath: string; framework: string } | null {
  const decParts = decorator.name.split('.');
  const methodCandidate = decParts.pop()?.toLowerCase() ?? '';
  const routerVar = decParts[0] ?? '';
  const prefix = routerPrefixes[routerVar] ?? '';
  const argsText = decorator.argumentsText ?? '';

  let method = methodCandidate.toUpperCase();
  let framework = 'FastAPI';

  if (methodCandidate === 'route') {
    framework = 'Flask';
    method = 'GET';
    const methodsMatch = argsText.match(/methods\s*=\s*\[([\s\S]*?)\]/);
    if (methodsMatch) {
      const parsedMethods = methodsMatch[1]
        .split(',')
        .map((m) => m.replace(/['"\s]/g, '').toUpperCase())
        .filter(Boolean);
      method = parsedMethods.join(',') || 'GET';
    }
  } else if (!HTTP_METHODS.has(methodCandidate)) {
    return null;
  }

  const pathMatch = argsText.match(/["']([^"']+)["']/);
  if (!pathMatch) return null;

  const rawPath = pathMatch[1];
  if (prefix) {
    const cleanPrefix = '/' + prefix.replace(/^\/+|\/+$/g, '');
    const cleanSub = rawPath.replace(/^\/+/, '');
    const fullPath = cleanSub ? `${cleanPrefix}/${cleanSub}` : cleanPrefix;
    return { method, fullPath, framework };
  }

  const fullPath = '/' + rawPath.replace(/^\/+/, '');
  return { method, fullPath, framework };
}

function extractImports(file: DiscoveredFile, facts: import('../parser/types').SyntaxFacts, result: PartialAnalysis): void {
  for (const imported of facts.imports) {
    result.imports.push({
      id: `${file.path}:import:${imported.range.startLine}:${imported.module}`,
      source: file.path,
      module: imported.module,
      names: [...imported.names],
      line: imported.range.startLine,
      target: null,
      external: false,
    });
    recordExternal(imported.module, result);
  }
}

function extractCalls(file: DiscoveredFile, facts: import('../parser/types').SyntaxFacts, result: PartialAnalysis): void {
  for (const call of facts.calls) {
    const ownerSymbol = call.ownerQualifiedName ? `${file.path}::${call.ownerQualifiedName}` : null;
    const sourceId = ownerSymbol ?? file.path;
    const line = call.range.startLine;

    result.calls.push({
      id: `${sourceId}:call:${line}:${call.callee}`,
      source: sourceId,
      callee: call.callee,
      file: file.path,
      line,
      target: null,
      confidence: 0.55,
    });

    if (call.callee.endsWith('FastAPI')) {
      result.frameworks.add('FastAPI');
      result.entrypointEvidence.push('creates a FastAPI application');
    } else if (call.callee.endsWith('Flask')) {
      result.frameworks.add('Flask');
      result.entrypointEvidence.push('creates a Flask application');
    } else if (call.callee.endsWith('create_engine') || call.callee.endsWith('sessionmaker')) {
      result.frameworks.add('SQLAlchemy');
      result.databases.add('SQL database');
    }
  }
}

function recordExternal(moduleName: string, result: PartialAnalysis): void {
  const root = moduleName.replace(/^\.+/, '').split('.')[0];
  if (EXTERNALS[root]) {
    result.externals.add(EXTERNALS[root]);
  }
  if (root === 'fastapi') result.frameworks.add('FastAPI');
  else if (root === 'flask') result.frameworks.add('Flask');
  else if (root === 'django') result.frameworks.add('Django');
  else if (root === 'sqlalchemy') {
    result.frameworks.add('SQLAlchemy');
    result.databases.add('SQL database');
  } else if (root === 'sqlmodel') {
    result.frameworks.add('SQLModel');
    result.databases.add('SQL database');
  } else if (root === 'tortoise') {
    result.frameworks.add('Tortoise ORM');
    result.databases.add('SQL database');
  } else if (root === 'peewee') {
    result.frameworks.add('Peewee');
    result.databases.add('SQL database');
  } else if (root === 'beanie') {
    result.frameworks.add('Beanie');
    result.databases.add('MongoDB');
  }
}
