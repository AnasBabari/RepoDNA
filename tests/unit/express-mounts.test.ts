import { describe, expect, it } from 'vitest';
import { analyzeRepositoryFiles } from '../../app/lib/analyzer';
import type { DiscoveredFile } from '../../app/lib/analyzer/types';

function sourceFile(path: string, content: string): DiscoveredFile {
  return { path, content, size: content.length, hash: `hash:${path}` };
}

async function analyze(files: DiscoveredFile[]) {
  return analyzeRepositoryFiles({ name: 'express-mounts', source: 'test:express-mounts', files, skipped: [] });
}

describe('Express router mount resolution', () => {
  it('composes a static CommonJS app.use prefix with router-local paths', async () => {
    const project = await analyze([
      sourceFile('src/app.js', `
const express = require('express');
const usersRouter = require('./routes/users');
const app = express();
app.use('/api/users', usersRouter);
`),
      sourceFile('src/routes/users.js', `
const express = require('express');
const usersRouter = express.Router();
function listUsers(req, res) { res.json([]); }
usersRouter.get('/', listUsers);
usersRouter.post('/:id', listUsers);
module.exports = usersRouter;
`),
    ]);

    expect(project.routes.map((route) => `${route.method} ${route.path}`).sort()).toEqual([
      'GET /api/users',
      'POST /api/users/:id',
    ]);
    expect(project.diagnostics.some((item) => item.code.includes('ROUTE_MOUNT_UNRESOLVED'))).toBe(false);
  });

  it('composes nested router.use prefixes across ES module imports', async () => {
    const project = await analyze([
      sourceFile('src/app.ts', `
import express from 'express';
import apiRouter from './routes/api';
const app = express();
app.use('/api', apiRouter);
`),
      sourceFile('src/routes/api.ts', `
import { Router } from 'express';
import usersRouter from './users';
const apiRouter = Router();
apiRouter.use('/users', usersRouter);
export default apiRouter;
`),
      sourceFile('src/routes/users.ts', `
import { Router } from 'express';
const usersRouter = Router();
function getUser(req, res) { res.json({}); }
usersRouter.get('/:id', getUser);
export default usersRouter;
`),
    ]);

    expect(project.routes).toHaveLength(1);
    expect(project.routes[0].path).toBe('/api/users/:id');
  });

  it('reports computed directory-driven mounts instead of presenting a complete route map', async () => {
    const project = await analyze([
      sourceFile('src/app.js', `
const express = require('express');
const path = require('path');
const app = express();
for (const file of routeFiles) {
  const router = require(path.join(routesDirectory, file));
  app.use(\`/api/\${file}\`, router);
}
`),
      sourceFile('src/routes/users.js', `
const express = require('express');
const router = express.Router();
function listUsers(req, res) { res.json([]); }
router.get('/', listUsers);
module.exports = router;
`),
    ]);

    expect(project.routes[0].path).toBe('/');
    const diagnostic = project.diagnostics.find((item) => item.code === 'DYNAMIC_ROUTE_MOUNT_UNRESOLVED');
    expect(diagnostic?.file).toBe('src/app.js');
    expect(diagnostic?.message).toContain('`/api/${file}`');
    expect(diagnostic?.message).toContain('routes beneath this mount may be missing or have incomplete paths');
  });

  it('does not report ordinary Express middleware as unresolved routers', async () => {
    const project = await analyze([
      sourceFile('src/app.js', `
const express = require('express');
const app = express();
app.use(express.json());
app.use(authenticateRequest);
`),
    ]);

    expect(project.diagnostics.some((item) => item.code.includes('ROUTE_MOUNT_UNRESOLVED'))).toBe(false);
  });
});
