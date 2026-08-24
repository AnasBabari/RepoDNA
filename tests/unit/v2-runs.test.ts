import { describe, expect, it, beforeEach } from 'vitest';
import { completeRun, createRun, failRun, getRun, recordProgress } from '../../app/lib/analyzer/v2/runs';

describe('v2 analysis run registry', () => {
  let run: ReturnType<typeof createRun>;

  beforeEach(() => {
    run = createRun({ owner: 'octocat', name: 'hello-wiki', url: 'https://github.com/octocat/hello-wiki' });
  });

  it('creates runs with deterministic initial state', () => {
    expect(run.status).toBe('queued');
    expect(run.stage).toBe('accepted');
    expect(run.events).toHaveLength(0);
    expect(run.result).toBeNull();
    expect(run.error).toBeNull();
  });

  it('records ordered progress events with monotonic seq', () => {
    recordProgress(run, { stage: 'download', message: 'Downloading repository archive' });
    recordProgress(run, { stage: 'parse', message: 'Parsing 12 source files', completedWork: 4, totalWork: 12, percent: 33 });
    expect(run.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(run.events[1].completedWork).toBe(4);
    expect(run.events[1].percent).toBe(33);
    expect(run.status).toBe('running');
  });

  it('completes with sanitized aggregate result metadata only', () => {
    recordProgress(run, { stage: 'validate', message: 'Validating graph contract', percent: 95 });
    completeRun(run, {
      schemaVersion: '2.0.0',
      coveragePercentage: 100,
      nodeCount: 42,
      edgeCount: 57,
      unresolvedCount: 3,
      completeness: { status: 'MOSTLY_MAPPED', reasons: ['unresolved relationships'] },
      project: { nodes: [], edges: [] },
    });
    expect(run.status).toBe('completed');
    const last = run.events[run.events.length - 1];
    expect(last.status).toBe('completed');
    expect(last.percent).toBe(100);
    // Aggregate metadata is exposed; raw project stays out of event stream.
    expect(run.result?.nodeCount).toBe(42);
    expect(JSON.stringify(run.events)).not.toContain('"nodes"');
  });

  it('fails with a structured error code', () => {
    recordProgress(run, { stage: 'download', message: 'Downloading repository archive' });
    failRun(run, 'WORKFLOW_REQUIRED', 'Repository exceeds inline thresholds.');
    expect(run.status).toBe('failed');
    expect(run.error?.code).toBe('WORKFLOW_REQUIRED');
    expect(run.events[run.events.length - 1].status).not.toBe('completed'); // failRun does not fabricate completion
  });

  it('retrieves runs by id and returns undefined for unknown ids', () => {
    expect(getRun(run.runId)?.runId).toBe(run.runId);
    expect(getRun('run_missing')).toBeUndefined();
  });

  it('never records repository source content in events', () => {
    recordProgress(run, { stage: 'parse', message: `Parsing Python files` });
    const serialized = JSON.stringify(run);
    expect(serialized).not.toContain('import ');
    expect(serialized).toContain('octocat'); // identity is public repo metadata, acceptable for public analyses
  });
});
