import { describe, expect, it } from 'vitest';
import { analyzeRepositoryFiles } from '../../app/lib/analyzer';
import type { DiscoveredFile } from '../../app/lib/analyzer/types';

describe('Cross-Engine Golden Structure Verification', () => {
  it('correctly maps mixed-language full stack architecture', () => {
    const discovery = {
      name: 'golden-app',
      source: 'test:fixture',
      skipped: [],
      files: [
        {
          path: 'package.json',
          size: 200,
          hash: 'h1',
          content: JSON.stringify({
            name: 'golden-app',
            dependencies: {
              react: '^19.0.0',
              next: '^15.0.0',
              '@prisma/client': '^5.0.0',
            },
          }),
        },
        {
          path: 'requirements.txt',
          size: 50,
          hash: 'h2',
          content: 'fastapi\nsqlalchemy\npsycopg2-binary\n',
        },
        {
          path: 'main.py',
          size: 300,
          hash: 'h3',
          content: `
from fastapi import FastAPI
from app.routes.api import router

app = FastAPI()
app.include_router(router)

if __name__ == '__main__':
    pass
`,
        },
        {
          path: 'app/routes/api.py',
          size: 400,
          hash: 'h4',
          content: `
from fastapi import APIRouter
from app.services.user import UserService

router = APIRouter(prefix="/api/users")

@router.get("/")
def get_users():
    return UserService.list_users()
`,
        },
        {
          path: 'app/services/user.py',
          size: 300,
          hash: 'h5',
          content: `
from app.models.user import User

class UserService:
    @staticmethod
    def list_users():
        return User.query()
`,
        },
        {
          path: 'app/models/user.py',
          size: 250,
          hash: 'h6',
          content: `
from sqlalchemy.orm import DeclarativeBase

class User(DeclarativeBase):
    pass
`,
        },
        {
          path: 'src/components/Dashboard.tsx',
          size: 300,
          hash: 'h7',
          content: `
import React from 'react';

export function Dashboard() {
  return <div>Dashboard</div>;
}
`,
        },
      ] as DiscoveredFile[],
    };

    const project = analyzeRepositoryFiles(discovery);

    // 1. Repository metadata
    expect(project.schemaVersion).toBe('1.1.0');
    expect(project.repository.name).toBe('golden-app');
    expect(project.repository.fileCount).toBe(7);

    // 2. Detected technologies
    expect(project.technologies).toContain('FastAPI');
    expect(project.technologies).toContain('React');
    expect(project.technologies).toContain('SQLAlchemy');
    expect(project.technologies).toContain('PostgreSQL');

    // 3. Components
    const compTypes = project.architecture.components.map((c) => c.type);
    expect(compTypes).toContain('api');
    expect(compTypes).toContain('services');
    expect(compTypes).toContain('database');
    expect(compTypes).toContain('frontend');
    expect(compTypes).toContain('configuration');

    // 4. Entrypoint
    expect(project.entrypoints.length).toBeGreaterThan(0);
    expect(project.entrypoints[0].file).toBe('main.py');
    expect(project.entrypoints[0].confidence).toBeGreaterThan(0.7);

    // 5. Routes and Flows
    expect(project.routes.length).toBe(1);
    expect(project.routes[0].path).toBe('/api/users');
    expect(project.routes[0].method).toBe('GET');
    expect(project.flows.length).toBe(1);
  });

  it('analyzes public GitHub repository live: Twitter-Sentiment-Analysis', async () => {
    const { analyzeGitHubUrl } = await import('../../app/lib/analyzer');
    const project = await analyzeGitHubUrl('https://github.com/yusrababari/Twitter-Sentiment-Analysis');

    expect(project.schemaVersion).toBe('1.1.0');
    expect(project.repository.name).toBe('Twitter-Sentiment-Analysis');
    expect(project.repository.fileCount).toBeGreaterThan(0);
    expect(project.metadata.executedRepositoryCode).toBe(false);
    expect(project.metadata.limits.maxFiles).toBe(10000);
    expect(project.architecture.components.length).toBeGreaterThan(0);
  }, 25000);
});
