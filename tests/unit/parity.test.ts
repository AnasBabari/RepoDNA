import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import { analyzeRepositoryFiles } from '../../app/lib/analyzer';
import { validateRepoDNAProject } from '../../app/lib/schema/validator';
import type { DiscoveredFile } from '../../app/lib/analyzer/types';
import type { RepoDNAProject } from '../../app/lib/types';

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

/**
 * Cross-engine parity is a fail-hard architectural invariant: if the Python
 * engine cannot be executed, crashes, emits unparseable output, or diverges
 * from the TypeScript engine, the parity case FAILS.
 *
 * Local development escape hatch only: contributors without a Python
 * environment may set REPODNA_ALLOW_PYTHON_PARITY_SKIP=1 to skip the Python
 * half of a parity case instead of failing. CI never sets this variable —
 * the dedicated `parity` workflow job enforces the contract fail-hard.
 */
const ALLOW_PYTHON_PARITY_SKIP = process.env.REPODNA_ALLOW_PYTHON_PARITY_SKIP === '1';

function runPythonEngineAnalysis(fixturePath: string): RepoDNAProject {
  const pyJson = execSync(
    `python -c "import sys, json; sys.path.insert(0, 'core'); from repodna.engine import analyze_repository; res = analyze_repository('${fixturePath}'); print(json.dumps(res.to_dict()))"`,
    { encoding: 'utf-8' }
  );
  return JSON.parse(pyJson) as RepoDNAProject;
}

interface ParityCase {
  fixtureName: string;
  expectedFramework: string;
  expectArchitectureComponents: boolean;
}

async function assertCrossEngineParity(parityCase: ParityCase, ctx: { skip: () => void }): Promise<void> {
  const fixturePath = `tests/fixtures/${parityCase.fixtureName}`;
  const files = readFixtureFiles(fixturePath);

  // 1. TypeScript Engine Analysis
  const tsResult = await analyzeRepositoryFiles(
    { name: parityCase.fixtureName, source: `file://${fixturePath}`, files, skipped: [] },
    {}
  );

  // Validate TS schema conformance
  const tsValidation = validateRepoDNAProject(tsResult);
  expect(tsValidation.valid).toBe(true);
  expect(tsValidation.errors).toEqual([]);

  // 2. Python Engine Analysis via CLI — fail-hard on any invocation or parse
  // failure so a missing Python engine can never silently pass parity.
  let pyResult: RepoDNAProject;
  try {
    pyResult = runPythonEngineAnalysis(fixturePath);
  } catch (e) {
    if (ALLOW_PYTHON_PARITY_SKIP) {
      console.warn(`REPODNA_ALLOW_PYTHON_PARITY_SKIP=1: skipping Python engine parity for '${parityCase.fixtureName}':`, e);
      ctx.skip();
    }
    throw new Error(
      `Python engine invocation failed for fixture '${parityCase.fixtureName}'. ` +
      'Cross-engine parity is enforced fail-hard; install the Python engine (python -m pip install -e .) ' +
      'or set REPODNA_ALLOW_PYTHON_PARITY_SKIP=1 to skip locally.',
      { cause: e }
    );
  }

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
  expect(tsResult.repository.fingerprint.frameworks).toContain(parityCase.expectedFramework);
  expect(pyResult.repository.fingerprint.frameworks).toContain(parityCase.expectedFramework);

  // Verify architecture component count
  if (parityCase.expectArchitectureComponents) {
    expect(tsResult.architecture.components.length).toBeGreaterThan(0);
    expect(pyResult.architecture.components.length).toBeGreaterThan(0);
  }
}

describe('Cross-Engine Conformance & Schema Parity Suite', () => {
  it('verifies schema validity and parity on fastapi-basic fixture', async (ctx) => {
    await assertCrossEngineParity(
      { fixtureName: 'fastapi-basic', expectedFramework: 'FastAPI', expectArchitectureComponents: true },
      ctx
    );
  });

  it('verifies schema validity and parity on express-basic fixture', async (ctx) => {
    await assertCrossEngineParity(
      { fixtureName: 'express-basic', expectedFramework: 'Express', expectArchitectureComponents: false },
      ctx
    );
  });
});
