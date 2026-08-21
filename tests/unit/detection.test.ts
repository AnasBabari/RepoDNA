import { describe, expect, it } from 'vitest';
import {
  environmentEvidence,
  fingerprint,
  languageFor,
  parseTsconfigPaths,
} from '../../app/lib/analyzer/detection';
import type { DiscoveredFile } from '../../app/lib/analyzer/types';

describe('detection module', () => {
  it('detects programming languages accurately', () => {
    expect(languageFor('src/app.py')).toBe('Python');
    expect(languageFor('src/index.ts')).toBe('TypeScript');
    expect(languageFor('src/Component.tsx')).toBe('TypeScript');
    expect(languageFor('src/utils.js')).toBe('JavaScript');
    expect(languageFor('src/Component.jsx')).toBe('JavaScript');
    expect(languageFor('db/schema.prisma')).toBe('Prisma');
    expect(languageFor('db/migration.sql')).toBe('SQL');
    expect(languageFor('config.toml')).toBe('Configuration');
    expect(languageFor('package.json')).toBe('Configuration');
    expect(languageFor('README.md')).toBe('Markdown');
  });

  it('parses tsconfig and jsconfig path aliases', () => {
    const files: DiscoveredFile[] = [
      {
        path: 'tsconfig.json',
        size: 200,
        hash: 'h1',
        content: JSON.stringify({
          compilerOptions: {
            baseUrl: '.',
            paths: {
              '@/*': ['./src/*'],
              '~components/*': ['./src/components/*'],
            },
          },
        }),
      },
    ];

    const aliases = parseTsconfigPaths(files);
    expect(aliases['@']).toBe('src');
    expect(aliases['~components']).toBe('src/components');
  });

  it('fingerprints technologies from package.json and requirements', () => {
    const files: DiscoveredFile[] = [
      {
        path: 'package.json',
        size: 300,
        hash: 'h2',
        content: JSON.stringify({
          dependencies: {
            react: '^19.0.0',
            next: '^15.0.0',
            '@prisma/client': '^5.0.0',
            ioredis: '^5.0.0',
          },
          devDependencies: {
            tailwindcss: '^4.0.0',
            vitest: '^1.0.0',
          },
        }),
      },
      {
        path: 'requirements.txt',
        size: 100,
        hash: 'h3',
        content: 'fastapi>=0.100.0\nsqlalchemy>=2.0.0\nuvicorn\ncelery\n',
      },
      {
        path: 'Dockerfile',
        size: 50,
        hash: 'h4',
        content: 'FROM python:3.11\nCMD ["uvicorn", "main:app"]',
      },
    ];

    const result = fingerprint(files);
    expect(result.frameworks).toContain('React');
    expect(result.frameworks).toContain('Next.js');
    expect(result.frameworks).toContain('FastAPI');
    expect(result.databases).toContain('Prisma');
    expect(result.databases).toContain('SQLAlchemy');
    expect(result.externalSystems).toContain('Redis');
    expect(result.externalSystems).toContain('Celery');
    expect(result.infrastructure).toContain('Docker');
    expect(result.testing).toContain('Vitest');
    expect(result.tooling).toContain('Tailwind CSS');
  });

  it('detects environment variable evidence across files', () => {
    const files: DiscoveredFile[] = [
      {
        path: 'src/config.ts',
        size: 200,
        hash: 'h5',
        content: 'const dbUrl = process.env.DATABASE_URL;\nconst redis = process.env.REDIS_URL;\n',
      },
      {
        path: 'src/billing.ts',
        size: 200,
        hash: 'h6',
        content: 'const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);\n',
      },
    ];

    const env = environmentEvidence(files);
    expect(env['PostgreSQL']).toBeDefined();
    expect(env['PostgreSQL'][0].file).toBe('src/config.ts');
    expect(env['Redis']).toBeDefined();
    expect(env['Stripe']).toBeDefined();
    expect(env['Stripe'][0].file).toBe('src/billing.ts');
  });
});
