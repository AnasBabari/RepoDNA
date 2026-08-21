import type { DiscoveredFile, PartialAnalysis } from '../types';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'websocket']);
const EXTERNALS: Record<string, string> = {
  stripe: 'Stripe', redis: 'Redis', boto3: 'AWS', openai: 'OpenAI',
  anthropic: 'Anthropic', supabase: 'Supabase', firebase_admin: 'Firebase',
  kafka: 'Kafka', aiokafka: 'Kafka', celery: 'Celery', pika: 'RabbitMQ',
  sendgrid: 'SendGrid', resend: 'Resend', twilio: 'Twilio', pymongo: 'MongoDB',
  motor: 'MongoDB', httpx: 'HTTPX', aiohttp: 'aiohttp',
};

export function analyzePython(file: DiscoveredFile): PartialAnalysis {
  const source = file.content;
  const lines = source.split(/\r?\n/);
  const lineCount = lines.length;

  const result: PartialAnalysis = {
    file: {
      id: `file:${file.path}`,
      path: file.path,
      language: 'Python',
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

  // 1. Router variable prefixes e.g. router = APIRouter(prefix="/api/v1") or Blueprint("name", __name__, url_prefix="/api/v1")
  const routerPrefixes: Record<string, string> = {};
  const routerAssignRe = /\b([a-zA-Z_$][\w$]*)\s*=\s*(?:APIRouter|Blueprint)\s*\(([\s\S]*?)\)/g;
  let match: RegExpExecArray | null;
  while ((match = routerAssignRe.exec(source)) !== null) {
    const varName = match[1];
    const args = match[2];
    const prefixMatch = args.match(/(?:prefix|url_prefix)\s*=\s*["']([^"']+)["']/);
    if (prefixMatch) {
      routerPrefixes[varName] = prefixMatch[1];
    }
  }

  // 2. Imports: "import x, y as z" and "from .module import a, b"
  lines.forEach((lineText, idx) => {
    const lineNum = idx + 1;
    const trimmed = lineText.trim();
    if (trimmed.startsWith('#')) return;

    // from module import names
    const fromMatch = trimmed.match(/^from\s+([a-zA-Z0-9_.]+)\s+import\s+([\s\S]+)/);
    if (fromMatch) {
      const moduleName = fromMatch[1];
      const names = fromMatch[2].split(',').map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean);
      result.imports.push({
        id: `${file.path}:import:${lineNum}:${moduleName}`,
        source: file.path,
        module: moduleName,
        names,
        line: lineNum,
        target: null,
        external: false,
      });
      recordExternal(moduleName, result);
      return;
    }

    // import module as alias
    const importMatch = trimmed.match(/^import\s+([a-zA-Z0-9_., ]+)/);
    if (importMatch) {
      const parts = importMatch[1].split(',');
      for (const part of parts) {
        const mod = part.trim().split(/\s+as\s+/)[0];
        if (!mod) continue;
        result.imports.push({
          id: `${file.path}:import:${lineNum}:${mod}`,
          source: file.path,
          module: mod,
          names: [mod],
          line: lineNum,
          target: null,
          external: false,
        });
        recordExternal(mod, result);
      }
    }
  });

  // 3. Classes & Functions with Decorators
  let currentClass: string | null = null;
  const pendingDecorators: { name: string; args: string; line: number }[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    const rawLine = lines[idx];
    const trimmed = rawLine.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    // Check indentation to know if inside class
    const indent = rawLine.search(/\S/);
    if (indent === 0 && !trimmed.startsWith('@')) {
      currentClass = null;
    }

    // Decorators: @router.get("/users") or @app.route("/items", methods=["POST"])
    if (trimmed.startsWith('@')) {
      const decMatch = trimmed.match(/^@([a-zA-Z0-9_.]+)(?:\((.*)\))?/);
      if (decMatch) {
        pendingDecorators.push({
          name: decMatch[1],
          args: decMatch[2] ?? '',
          line: lineNum,
        });
      }
      continue;
    }

    // Class definition
    const classMatch = trimmed.match(/^class\s+([a-zA-Z0-9_]+)(?:\s*\(([\s\S]*?)\))?\s*:/);
    if (classMatch) {
      const className = classMatch[1];
      const bases = (classMatch[2] ?? '').split(',').map((b) => b.trim());
      currentClass = className;

      let type = 'class';
      const evidence: string[] = [];

      const isModel = bases.some((b) =>
        b.endsWith('Base') ||
        b.endsWith('DeclarativeBase') ||
        b.includes('models.Model') ||
        b === 'Model' ||
        b.endsWith('Model') ||
        b === 'SQLModel' ||
        b.endsWith('Document')
      );

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

      result.symbols.push({
        id: `${file.path}::${className}`,
        type,
        name: className,
        file: file.path,
        line: lineNum,
        end_line: null,
        parent: null,
        exported: true,
        evidence,
      });

      pendingDecorators.length = 0;
      continue;
    }

    // Function or method definition
    const funcMatch = trimmed.match(/^(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\(/);
    if (funcMatch) {
      const funcName = funcMatch[1];
      const kind = currentClass ? 'method' : 'function';
      const parent = currentClass ? `${file.path}::${currentClass}` : null;
      const symbolId = currentClass ? `${file.path}::${currentClass}::${funcName}` : `${file.path}::${funcName}`;

      result.symbols.push({
        id: symbolId,
        type: kind,
        name: funcName,
        file: file.path,
        line: lineNum,
        end_line: null,
        parent,
        exported: true,
        evidence: [],
      });

      // Check pending decorators for routes
      for (const dec of pendingDecorators) {
        const decParts = dec.name.split('.');
        const methodCandidate = decParts.pop()?.toLowerCase() ?? '';
        const routerVar = decParts[0] ?? '';
        const prefix = routerPrefixes[routerVar] ?? '';

        let method = methodCandidate.toUpperCase();
        let framework = 'FastAPI';

        if (methodCandidate === 'route') {
          framework = 'Flask';
          method = 'GET';
          const methodsMatch = dec.args.match(/methods\s*=\s*\[([\s\S]*?)\]/);
          if (methodsMatch) {
            const parsedMethods = methodsMatch[1]
              .split(',')
              .map((m) => m.replace(/['"\s]/g, '').toUpperCase())
              .filter(Boolean);
            method = parsedMethods.join(',') || 'GET';
          }
        } else if (!HTTP_METHODS.has(methodCandidate)) {
          continue;
        }

        const pathMatch = dec.args.match(/["']([^"']+)["']/);
        if (!pathMatch) continue;

        const rawPath = pathMatch[1];
        let fullPath = rawPath;
        if (prefix) {
          const cleanPrefix = '/' + prefix.replace(/^\/+|\/+$/g, '');
          const cleanSub = rawPath.replace(/^\/+/, '');
          fullPath = cleanSub ? `${cleanPrefix}/${cleanSub}` : cleanPrefix;
        } else {
          fullPath = '/' + rawPath.replace(/^\/+/, '');
        }

        result.frameworks.add(framework);
        result.routes.push({
          id: `route:${file.path}:${lineNum}:${method}:${fullPath}`,
          method,
          path: fullPath,
          handler: symbolId,
          file: file.path,
          line: lineNum,
          framework,
          confidence: 0.98,
        });
      }

      pendingDecorators.length = 0;
      continue;
    }

    // Call expressions e.g. UserService.create() or save_user()
    const callMatches = trimmed.matchAll(/\b([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\s*\(/g);
    for (const cMatch of callMatches) {
      const callee = cMatch[1];
      if (['if', 'for', 'while', 'def', 'class', 'return', 'with', 'try', 'except'].includes(callee)) continue;
      const lastSymbol = result.symbols[result.symbols.length - 1];
      const sourceId = lastSymbol ? lastSymbol.id : file.path;

      result.calls.push({
        id: `${sourceId}:call:${lineNum}:${callee}`,
        source: sourceId,
        callee,
        file: file.path,
        line: lineNum,
        target: null,
        confidence: 0.55,
      });

      if (callee.endsWith('FastAPI')) {
        result.frameworks.add('FastAPI');
        result.entrypointEvidence.push('creates a FastAPI application');
      } else if (callee.endsWith('Flask')) {
        result.frameworks.add('Flask');
        result.entrypointEvidence.push('creates a Flask application');
      } else if (callee.endsWith('create_engine') || callee.endsWith('sessionmaker')) {
        result.frameworks.add('SQLAlchemy');
        result.databases.add('SQL database');
      }
    }

    // Execution guard
    if (trimmed.replace(/\s/g, '').includes("__name__=='__main__'") || trimmed.replace(/\s/g, '').includes('__name__=="__main__"')) {
      result.entrypointEvidence.push('contains a __main__ execution guard');
    }
  }

  const lowered = source.toLowerCase();
  if (lowered.includes('postgresql://') || lowered.includes('postgres://')) {
    result.databases.add('PostgreSQL');
  }
  if (lowered.includes('mongodb://') || lowered.includes('mongodb+srv://')) {
    result.databases.add('MongoDB');
  }

  return result;
}

function recordExternal(moduleName: string, result: PartialAnalysis) {
  const root = moduleName.split('.')[0];
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
