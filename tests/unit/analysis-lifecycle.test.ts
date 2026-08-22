import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  ANALYSIS_COMPLETE_STEP,
  AnalysisCancelledError,
  auditArchitectureConsistency,
  runAnalysisLifecycle,
} from '../../app/lib/analysis-lifecycle';
import type { RepoDNAProject } from '../../app/lib/types';

const instantTiming = {
  discoveryStepMs: 0,
  verificationStepMs: 0,
  completedStateMs: 0,
};

function projectFixture(): RepoDNAProject {
  return {
    schemaVersion: '1.0.0',
    generatedAt: '2026-08-22T00:00:00.000Z',
    repository: {
      name: 'fixture',
      source: 'local',
      languages: { TypeScript: 1 },
      fileCount: 1,
      sourceFileCount: 1,
      parsedFileCount: 1,
      lines: 3,
      fingerprint: {
        languages: ['TypeScript'], frameworks: [], infrastructure: [], databases: [],
        externalSystems: [], testing: [], buildTools: [],
      },
    },
    technologies: ['TypeScript'],
    files: [{ id: 'file:index', path: 'src/index.ts', language: 'TypeScript', lines: 3, bytes: 30, hash: 'abc', role: 'source', parsed: true, error: null }],
    symbols: [{ id: 'symbol:main', type: 'function', name: 'main', file: 'src/index.ts', line: 1, parent: null, exported: true, evidence: [] }],
    imports: [], calls: [], routes: [], databases: [], externalSystems: [], external_systems: [],
    entrypoints: [{ id: 'entry:index', file: 'src/index.ts', kind: 'application', score: 1, confidence: 1, evidence: [] }],
    flows: [],
    architecture: {
      components: [{ id: 'component:app', name: 'Application', type: 'service', files: ['src/index.ts'], confidence: 1, evidence: [] }],
      connections: [],
    },
    importantFiles: [], important_files: [], onboarding: [],
    metrics: {
      complexityScore: 1, localDependencies: 0, externalDependencies: 0, dependencyCycles: [],
      mostConnectedFiles: [], highCouplingFiles: [], symbols: 1, routes: 0, components: 1, parseSuccessRate: 100,
    },
    diagnostics: [],
    metadata: {
      analysisMode: 'static', executedRepositoryCode: false,
      limits: { maxFiles: 1000, maxFileBytes: 1000000 },
      fileComponents: { 'src/index.ts': 'component:app' }, cache: { hits: 0, misses: 1 },
    },
  };
}

describe('analysis progress lifecycle', () => {
  it('shows every phase and a completed state even when analysis is instant', async () => {
    const steps: number[] = [];
    const validate = vi.fn();
    const project = projectFixture();

    const result = await runAnalysisLifecycle({
      analyze: async () => project,
      validate,
      onStep: (step) => steps.push(step),
      timing: instantTiming,
    });

    expect(result).toBe(project);
    expect(steps).toEqual([0, 1, 2, 3, 4, 5, ANALYSIS_COMPLETE_STEP]);
    expect(validate).toHaveBeenCalledWith(project);
  });

  it('keeps a fast result behind the splash until every timed phase is visible', async () => {
    vi.useFakeTimers();
    try {
      const steps: number[] = [];
      let settled = false;
      const lifecycle = runAnalysisLifecycle({
        analyze: async () => projectFixture(),
        validate: vi.fn(),
        onStep: (step) => steps.push(step),
        timing: { discoveryStepMs: 10, verificationStepMs: 10, completedStateMs: 10 },
      }).then((result) => {
        settled = true;
        return result;
      });

      await vi.advanceTimersByTimeAsync(59);
      expect(steps).toEqual([0, 1, 2, 3, 4, 5, ANALYSIS_COMPLETE_STEP]);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(lifecycle).resolves.toMatchObject({ schemaVersion: '1.0.0' });
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits at graph resolution until the repository analysis settles', async () => {
    let resolveAnalysis!: (value: string) => void;
    const analysis = new Promise<string>((resolve) => { resolveAnalysis = resolve; });
    const steps: number[] = [];

    const lifecycle = runAnalysisLifecycle({
      analyze: () => analysis,
      validate: vi.fn(),
      onStep: (step) => steps.push(step),
      timing: instantTiming,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(steps).toEqual([0, 1, 2, 3]);

    resolveAnalysis('complete');
    await expect(lifecycle).resolves.toBe('complete');
    expect(steps).toEqual([0, 1, 2, 3, 4, 5, ANALYSIS_COMPLETE_STEP]);
  });

  it('stops stale progress updates when an analysis is cancelled', async () => {
    const controller = new AbortController();
    const steps: number[] = [];
    const lifecycle = runAnalysisLifecycle({
      analyze: async () => projectFixture(),
      validate: vi.fn(),
      onStep: (step) => {
        steps.push(step);
        if (step === 1) controller.abort();
      },
      signal: controller.signal,
      timing: { discoveryStepMs: 1, verificationStepMs: 1, completedStateMs: 1 },
    });

    await expect(lifecycle).rejects.toBeInstanceOf(AnalysisCancelledError);
    expect(steps).toEqual([0, 1]);
  });

  it('exits immediately when cancelled while waiting for a slow analyzer', async () => {
    const controller = new AbortController();
    const steps: number[] = [];
    const lifecycle = runAnalysisLifecycle({
      analyze: () => new Promise<RepoDNAProject>(() => undefined),
      validate: vi.fn(),
      onStep: (step) => steps.push(step),
      signal: controller.signal,
      timing: instantTiming,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(steps).toEqual([0, 1, 2, 3]);
    controller.abort();
    await expect(lifecycle).rejects.toBeInstanceOf(AnalysisCancelledError);
  });
});

describe('architecture consistency audit', () => {
  it('accepts a self-consistent visual model', () => {
    const result = auditArchitectureConsistency(projectFixture());
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.checks).toBeGreaterThan(10);
  });

  it('finds stale metrics and dangling visual graph references', () => {
    const project = projectFixture();
    project.metrics.components = 2;
    project.architecture.connections.push({
      id: 'connection:missing', source: 'component:app', target: 'component:missing', type: 'calls', weight: 1,
    });

    const result = auditArchitectureConsistency(project);
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('Component metric does not match architecture components.');
    expect(result.issues).toContain('Architecture connection connection:missing has a missing target component.');
  });

  const sampleFiles = [
    'public/demo-project.json',
    ...readdirSync(join(process.cwd(), 'public/samples'))
      .filter((file) => file.endsWith('.json'))
      .map((file) => `public/samples/${file}`),
  ];

  it.each(sampleFiles)('accepts the checked-in artifact %s', (sampleFile) => {
    const project = JSON.parse(readFileSync(join(process.cwd(), sampleFile), 'utf8')) as RepoDNAProject;
    const result = auditArchitectureConsistency(project);
    expect(result.issues, result.issues.join('\n')).toEqual([]);
  });
});
