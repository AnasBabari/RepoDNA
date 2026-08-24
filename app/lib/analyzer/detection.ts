import type { DiscoveredFile } from './types';

export const LANGUAGES: Record<string, string> = {
  '.py': 'Python', '.pyi': 'Python', '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.go': 'Go', '.sql': 'SQL', '.prisma': 'Prisma', '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS',
  '.json': 'Configuration', '.toml': 'Configuration', '.yaml': 'Configuration', '.yml': 'Configuration',
  '.md': 'Markdown', '.mdx': 'Markdown', '.graphql': 'GraphQL', '.gql': 'GraphQL',
  '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell',
};

export const PACKAGE_TECH: Record<string, [category: string, name: string]> = {
  // Web & UI Frameworks
  react: ['framework', 'React'], next: ['framework', 'Next.js'],
  express: ['framework', 'Express'], '@nestjs/core': ['framework', 'NestJS'],
  vue: ['framework', 'Vue'], nuxt: ['framework', 'Nuxt'],
  svelte: ['framework', 'Svelte'], '@sveltejs/kit': ['framework', 'SvelteKit'],
  astro: ['framework', 'Astro'], remix: ['framework', 'Remix'],
  '@remix-run/react': ['framework', 'Remix'], 'solid-js': ['framework', 'SolidJS'],
  hono: ['framework', 'Hono'], fastify: ['framework', 'Fastify'],
  koa: ['framework', 'Koa'], '@trpc/server': ['framework', 'tRPC'],
  gatsby: ['framework', 'Gatsby'], electron: ['framework', 'Electron'],

  // Build & Tooling
  vite: ['build', 'Vite'], webpack: ['build', 'Webpack'],
  rollup: ['build', 'Rollup'], esbuild: ['build', 'esbuild'],
  turbo: ['build', 'Turborepo'], tailwindcss: ['tooling', 'Tailwind CSS'],
  '@tailwindcss/postcss': ['tooling', 'Tailwind CSS'],

  // Testing
  vitest: ['testing', 'Vitest'], '@playwright/test': ['testing', 'Playwright'],
  playwright: ['testing', 'Playwright'], jest: ['testing', 'Jest'],
  cypress: ['testing', 'Cypress'], mocha: ['testing', 'Mocha'],
  '@testing-library/react': ['testing', 'Testing Library'],

  // Databases & ORMs
  prisma: ['database', 'Prisma'], '@prisma/client': ['database', 'Prisma'],
  'drizzle-orm': ['database', 'Drizzle ORM'], typeorm: ['database', 'TypeORM'],
  knex: ['database', 'Knex'], kysely: ['database', 'Kysely'],
  'mikro-orm': ['database', 'MikroORM'],
  pg: ['database', 'PostgreSQL'], postgres: ['database', 'PostgreSQL'],
  mysql: ['database', 'MySQL'], mysql2: ['database', 'MySQL'],
  sqlite3: ['database', 'SQLite'], 'better-sqlite3': ['database', 'SQLite'],
  mongodb: ['database', 'MongoDB'], mongoose: ['database', 'MongoDB'],

  // External APIs & Services
  redis: ['external', 'Redis'], ioredis: ['external', 'Redis'],
  stripe: ['external', 'Stripe'], openai: ['external', 'OpenAI'],
  '@anthropic-ai/sdk': ['external', 'Anthropic'], '@supabase/supabase-js': ['external', 'Supabase'],
  firebase: ['external', 'Firebase'], 'firebase-admin': ['external', 'Firebase'],
  kafkajs: ['external', 'Kafka'], amqplib: ['external', 'RabbitMQ'],
  graphql: ['external', 'GraphQL'], '@apollo/server': ['external', 'GraphQL'],
  '@apollo/client': ['external', 'GraphQL'], '@grpc/grpc-js': ['external', 'gRPC'],
  twilio: ['external', 'Twilio'], resend: ['external', 'Resend'],
  '@sendgrid/mail': ['external', 'SendGrid'], '@aws-sdk/client-s3': ['external', 'AWS'],
};

export const PYTHON_TECH: Record<string, [category: string, name: string]> = {
  // Web Frameworks
  fastapi: ['framework', 'FastAPI'], flask: ['framework', 'Flask'],
  django: ['framework', 'Django'], tornado: ['framework', 'Tornado'],
  sanic: ['framework', 'Sanic'], litestar: ['framework', 'Litestar'],
  starlette: ['framework', 'Starlette'],

  // Databases & ORMs
  sqlalchemy: ['database', 'SQLAlchemy'], sqlmodel: ['database', 'SQLModel'],
  'tortoise-orm': ['database', 'Tortoise ORM'], peewee: ['database', 'Peewee'],
  beanie: ['database', 'Beanie'], motor: ['database', 'MongoDB'],
  pymongo: ['database', 'MongoDB'], alembic: ['database', 'Alembic'],
  psycopg: ['database', 'PostgreSQL'], psycopg2: ['database', 'PostgreSQL'],
  'psycopg2-binary': ['database', 'PostgreSQL'], asyncpg: ['database', 'PostgreSQL'],
  aiomysql: ['database', 'MySQL'], aiosqlite: ['database', 'SQLite'],

  // External & Async
  redis: ['external', 'Redis'], celery: ['external', 'Celery'],
  stripe: ['external', 'Stripe'], openai: ['external', 'OpenAI'],
  anthropic: ['external', 'Anthropic'], supabase: ['external', 'Supabase'],
  boto3: ['external', 'AWS'], pika: ['external', 'RabbitMQ'],
  aiokafka: ['external', 'Kafka'], 'kafka-python': ['external', 'Kafka'],
  grpcio: ['external', 'gRPC'], 'strawberry-graphql': ['external', 'GraphQL'],
  graphene: ['external', 'GraphQL'], sendgrid: ['external', 'SendGrid'],
  resend: ['external', 'Resend'], twilio: ['external', 'Twilio'],
  httpx: ['external', 'HTTPX'], aiohttp: ['external', 'aiohttp'],

  // Testing & Tooling
  pytest: ['testing', 'pytest'], unittest: ['testing', 'unittest'],
  ruff: ['tooling', 'Ruff'], mypy: ['tooling', 'mypy'],
};

export function languageFor(path: string): string {
  const dotIndex = path.lastIndexOf('.');
  if (dotIndex === -1) return 'Configuration';
  const suffix = path.slice(dotIndex).toLowerCase();
  return LANGUAGES[suffix] ?? 'Configuration';
}

export function parseTsconfigPaths(files: DiscoveredFile[]): Record<string, string> {
  const configFile = files.find((f) => f.path === 'tsconfig.json' || f.path === 'jsconfig.json');
  if (!configFile) return {};

  try {
    const cleaned = configFile.content
      .replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')
      .replace(/,\s*([\]}])/g, '$1');
    const data = JSON.parse(cleaned);
    const compilerOpts = data?.compilerOptions ?? {};
    const baseUrl = (compilerOpts.baseUrl ?? '.').replace(/\/+$/, '');
    const paths = compilerOpts.paths ?? {};
    const aliases: Record<string, string> = {};

    for (const [aliasKey, targets] of Object.entries(paths)) {
      if (!Array.isArray(targets) || targets.length === 0) continue;
      const target = String(targets[0]);
      const prefix = aliasKey.replace(/\*+$/, '').replace(/\/+$/, '');
      let dest = target.replace(/\*+$/, '').replace(/\/+$/, '');
      if (baseUrl && baseUrl !== '.') {
        dest = `${baseUrl}/${dest}`.replace(/^\.?\//, '');
      } else {
        dest = dest.replace(/^\.?\//, '');
      }
      aliases[prefix] = dest;
    }
    return aliases;
  } catch {
    return {};
  }
}

export function fingerprint(files: DiscoveredFile[]): {
  languages: string[];
  languageFileCounts: Record<string, number>;
  frameworks: string[];
  infrastructure: string[];
  databases: string[];
  externalSystems: string[];
  testing: string[];
  buildTools: string[];
  tooling: string[];
} {
  const categories: Record<string, Set<string>> = {
    framework: new Set(),
    infrastructure: new Set(),
    database: new Set(),
    external: new Set(),
    testing: new Set(),
    build: new Set(),
    tooling: new Set(),
  };

  const fileCounts: Record<string, number> = {};
  for (const file of files) {
    const lang = languageFor(file.path);
    if (lang !== 'Configuration' && lang !== 'Markdown') {
      fileCounts[lang] = (fileCounts[lang] ?? 0) + 1;
    }
  }

  // Parse package.json
  const packageFile = files.find((f) => f.path === 'package.json');
  if (packageFile) {
    try {
      const pkg = JSON.parse(packageFile.content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const dep of Object.keys(deps)) {
        if (PACKAGE_TECH[dep]) {
          const [cat, val] = PACKAGE_TECH[dep];
          categories[cat]?.add(val);
        } else if (dep.startsWith('@')) {
          const scope = dep.split('/')[0];
          if (PACKAGE_TECH[scope]) {
            const [cat, val] = PACKAGE_TECH[scope];
            categories[cat]?.add(val);
          }
        }
      }
      if (pkg.scripts) {
        categories.tooling.add('npm scripts');
      }
    } catch {}
  }

  // Parse Python requirements & pyproject.toml
  const pyDepsText = files
    .filter((f) => ['requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py'].includes(f.path.split('/').pop()!))
    .map((f) => f.content.toLowerCase())
    .join('\n');

  for (const [dep, [cat, val]] of Object.entries(PYTHON_TECH)) {
    const regex = new RegExp(`(?<![a-z0-9_-])${dep.replace(/[-_]/g, '[-_]')}(?![a-z0-9_-])`, 'i');
    if (regex.test(pyDepsText)) {
      categories[cat]?.add(val);
    }
  }

  // Infrastructure & file manifests
  const filePaths = new Set(files.map((f) => f.path));
  for (const p of filePaths) {
    const filename = p.split('/').pop()!;
    if (filename === 'Dockerfile' || filename.startsWith('Dockerfile.')) {
      categories.infrastructure.add('Docker');
    }
    if (['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].includes(filename)) {
      categories.infrastructure.add('Docker Compose');
    }
    if (p.startsWith('.github/workflows/')) {
      categories.infrastructure.add('GitHub Actions');
    }
    if (filename.endsWith('schema.prisma')) {
      categories.database.add('Prisma');
    }
    if (filename.startsWith('next.config.')) {
      categories.framework.add('Next.js');
    }
    if (filename.startsWith('vite.config.')) {
      categories.build.add('Vite');
    }
    if (filename.startsWith('tailwind.config.')) {
      categories.tooling.add('Tailwind CSS');
    }
  }

  return {
    languages: Object.keys(fileCounts).sort(),
    languageFileCounts: fileCounts,
    frameworks: Array.from(categories.framework).sort(),
    infrastructure: Array.from(categories.infrastructure).sort(),
    databases: Array.from(categories.database).sort(),
    externalSystems: Array.from(categories.external).sort(),
    testing: Array.from(categories.testing).sort(),
    buildTools: Array.from(categories.build).sort(),
    tooling: Array.from(categories.tooling).sort(),
  };
}

export function environmentEvidence(files: DiscoveredFile[]): Record<string, { file: string; line: number; kind: string }[]> {
  const patterns: Record<string, RegExp> = {
    PostgreSQL: /\b(?:DATABASE_URL|POSTGRES(?:QL)?_URL|PGHOST)\b/g,
    Redis: /\b(?:REDIS_URL|REDIS_HOST)\b/g,
    MongoDB: /\b(?:MONGO(?:DB)?_URI|MONGODB_URL)\b/g,
    Stripe: /\bSTRIPE_(?:SECRET_KEY|API_KEY|WEBHOOK_SECRET)\b/g,
    OpenAI: /\bOPENAI_API_KEY\b/g,
    Anthropic: /\bANTHROPIC_API_KEY\b/g,
    Supabase: /\bSUPABASE_(?:URL|KEY|ANON_KEY)\b/g,
    AWS: /\bAWS_(?:ACCESS_KEY_ID|REGION|S3_BUCKET)\b/g,
    SendGrid: /\bSENDGRID_API_KEY\b/g,
    Resend: /\bRESEND_API_KEY\b/g,
    Twilio: /\bTWILIO_(?:ACCOUNT_SID|AUTH_TOKEN)\b/g,
  };

  const found: Record<string, { file: string; line: number; kind: string }[]> = {};

  for (const file of files) {
    if (file.path.toLowerCase().endsWith('.md') || file.path.toLowerCase().endsWith('.txt')) continue;
    for (const [name, pattern] of Object.entries(patterns)) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(file.content)) !== null) {
        if (!found[name]) found[name] = [];
        const line = (file.content.slice(0, match.index).match(/\n/g) || []).length + 1;
        found[name].push({ file: file.path, line, kind: 'environment_variable' });
      }
    }
  }

  return found;
}
