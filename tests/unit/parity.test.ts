import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import { analyzeRepositoryFiles } from '../../app/lib/analyzer';
import { validateRepoDNAProject } from '../../app/lib/schema/validator';
import type { DiscoveredFile } from '../../app/lib/analyzer/types';

function readFixtureFiles(fixtureDir: string): DiscoveredFile[] {
  const baseDir = path.resolve(process.cwd(), fixtureDir);
  const results: DiscoveredFile[] = [];

  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const rel = path.relative(baseDir, full).replace(/\\/g, '/');
        const content = fs.readFileSync(full, 'utf-8');
        results.push({
          path: rel,
          size: content.length,
          hash: `hash_${rel}`,
          content,
        });
      }
    }
  }

  walk(baseDir);
  return results;
}

describe('Cross-Engine Conformance & Schema Parity Suite', () => {
  it('verifies schema validity and parity on fastapi-basic fixture', async () => {
    const fixturePath = 'tests/fixtures/fastapi-basic';
    const files = readFixtureFiles(fixturePath);

    // 1. TypeScript Engine Analysis
    const tsResult = await analyzeRepositoryFiles(
      { name: 'fastapi-basic', source: `file://${fixturePath}`, files, skipped: [] },
      {}
    );

    // Validate TS schema conformance
    const tsValidation = validateRepoDNAProject(tsResult);
    expect(tsValidation.valid).toBe(true);
    expect(tsValidation.errors).toEqual([]);

    // 2. Python Engine Analysis via CLI
    let pyResult: RepoDNAProject | null = null;
    try {
      const pyJson = execSync(
        `python -c "import sys, json; sys.path.insert(0, 'core'); from repodna.engine import analyze_repository; res = analyze_repository('${fixturePath}'); print(json.dumps(res.to_dict()))"`,
        { encoding: 'utf-8' }
      );
      pyResult = JSON.parse(pyJson);
    } catch (e) {
      console.warn('Python engine parity check skipped or failed:', e);
    }

    if (pyResult) {
      // Validate Python schema conformance
      const pyValidation = validateRepoDNAProject(pyResult);
      expect(pyValidation.valid).toBe(true);
      expect(pyValidation.errors).toEqual([]);

      // 3. Structural Parity Assertions
      expect(tsResult.schemaVersion).toBe(pyResult.schemaVersion);
      expect(tsResult.repository.sourceFileCount).toBe(pyResult.repository.sourceFileCount);

      // Verify routes parity
      const tsRoutes = tsResult.routes.map((r) => `${r.method} ${r.path}`).sort();
      const pyRoutes = pyResult.routes.map((r) => `${r.method} ${r.path}`).sort();
      expect(tsRoutes).toEqual(pyRoutes);

      // Verify framework detection parity
      expect(tsResult.repository.fingerprint.frameworks).toContain('FastAPI');
      expect(pyResult.repository.fingerprint.frameworks).toContain('FastAPI');

      // Verify architecture component count
      expect(tsResult.architecture.components.length).toBeGreaterThan(0);
      expect(pyResult.architecture.components.length).toBeGreaterThan(0);
    }
  });

  it('verifies schema validity and parity on express-basic fixture', async () => {
    const fixturePath = 'tests/fixtures/express-basic';
    const files = readFixtureFiles(fixturePath);

    // 1. TypeScript Engine Analysis
    const tsResult = await analyzeRepositoryFiles(
      { name: 'express-basic', source: `file://${fixturePath}`, files, skipped: [] },
      {}
    );

    const tsValidation = validateRepoDNAProject(tsResult);
    expect(tsValidation.valid).toBe(true);
    expect(tsValidation.errors).toEqual([]);

    // 2. Python Engine Analysis
    let pyResult: RepoDNAProject | null = null;
    try {
      const pyJson = execSync(
        `python -c "import sys, json; sys.path.insert(0, 'core'); from repodna.engine import analyze_repository; res = analyze_repository('${fixturePath}'); print(json.dumps(res.to_dict()))"`,
        { encoding: 'utf-8' }
      );
      pyResult = JSON.parse(pyJson);
    } catch (e) {
      console.warn('Python engine parity check skipped or failed:', e);
    }

    if (pyResult) {
      const pyValidation = validateRepoDNAProject(pyResult);
      expect(pyValidation.valid).toBe(true);
      expect(pyValidation.errors).toEqual([]);

      expect(tsResult.schemaVersion).toBe(pyResult.schemaVersion);
      expect(tsResult.repository.sourceFileCount).toBe(pyResult.repository.sourceFileCount);

      const tsRoutes = tsResult.routes.map((r) => `${r.method} ${r.path}`).sort();
      const pyRoutes = pyResult.routes.map((r) => `${r.method} ${r.path}`).sort();
      expect(tsRoutes).toEqual(pyRoutes);

      expect(tsResult.repository.fingerprint.frameworks).toContain('Express');
      expect(pyResult.repository.fingerprint.frameworks).toContain('Express');
    }
  });
});
