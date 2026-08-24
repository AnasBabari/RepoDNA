/**
 * In-memory v2 analysis run registry.
 *
 * Runs are process-local and transient: they exist to power reconnectable
 * progress streams for public analyses during a session. Nothing here is
 * written to disk or Blob storage; only public-repository artifacts are ever
 * retained (in memory) and private repositories are never registered.
 */

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed';

export type RunStage =
  | 'accepted'
  | 'resolve'
  | 'download'
  | 'inventory'
  | 'parse'
  | 'resolve_relationships'
  | 'analytics'
  | 'validate'
  | 'complete';

export interface RunProgressEvent {
  seq: number;
  atMs: number;
  status: RunStatus;
  stage: RunStage;
  completedWork?: number;
  totalWork?: number;
  percent?: number;
  message: string;
  diagnosticCount?: number;
}

export interface AnalysisRun {
  runId: string;
  createdAt: number;
  repository: { owner: string; name: string; url: string; commitSha: string | null };
  status: RunStatus;
  stage: RunStage;
  events: RunProgressEvent[];
  startedAtMs: number | null;
  finishedAtMs: number | null;
  /** Present only for public repositories after successful completion. */
  result: {
    schemaVersion: string;
    coveragePercentage: number;
    nodeCount: number;
    edgeCount: number;
    unresolvedCount: number;
    completeness: { status: string; reasons: string[] };
    project: unknown;
  } | null;
  error: { code: string; message: string } | null;
}

const MAX_RUNS = 50;

const globalForRuns = globalThis as typeof globalThis & { __repodnaRuns?: Map<string, AnalysisRun> };
const runs = globalForRuns.__repodnaRuns ?? new Map<string, AnalysisRun>();
globalForRuns.__repodnaRuns = runs;

export function createRun(input: {
  owner: string;
  name: string;
  url: string;
  commitSha?: string | null;
}): AnalysisRun {
  const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const run: AnalysisRun = {
    runId,
    createdAt: Date.now(),
    repository: { owner: input.owner, name: input.name, url: input.url, commitSha: input.commitSha ?? null },
    status: 'queued',
    stage: 'accepted',
    events: [],
    startedAtMs: null,
    finishedAtMs: null,
    result: null,
    error: null,
  };
  // Bound memory: drop oldest completed runs first.
  if (runs.size >= MAX_RUNS) {
    const terminal = [...runs.entries()].filter(([, r]) => r.status === 'completed' || r.status === 'failed');
    if (terminal.length > 0) {
      terminal.sort((a, b) => a[1].createdAt - b[1].createdAt);
      runs.delete(terminal[0][0]);
    } else {
      const oldest = [...runs.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (oldest) runs.delete(oldest[0]);
    }
  }
  runs.set(runId, run);
  return run;
}

export function getRun(runId: string): AnalysisRun | undefined {
  return runs.get(runId);
}

export interface ProgressInput {
  stage: RunStage;
  message: string;
  status?: RunStatus;
  completedWork?: number;
  totalWork?: number;
  percent?: number;
  diagnosticCount?: number;
}

export function recordProgress(run: AnalysisRun, input: ProgressInput): void {
  const now = Date.now();
  if (run.startedAtMs === null) run.startedAtMs = now;
  const seq = run.events.length + 1;
  const event: RunProgressEvent = {
    seq,
    atMs: now - run.createdAt,
    status: input.status ?? (run.status === 'queued' ? 'running' : run.status),
    stage: input.stage,
    message: input.message,
  };
  if (typeof input.completedWork === 'number') event.completedWork = input.completedWork;
  if (typeof input.totalWork === 'number') event.totalWork = input.totalWork;
  if (typeof input.percent === 'number') event.percent = Math.round(input.percent);
  if (typeof input.diagnosticCount === 'number') event.diagnosticCount = input.diagnosticCount;
  run.events.push(event);
  run.stage = input.stage;
  run.status = input.status ?? 'running';
}

export function completeRun(run: AnalysisRun, result: NonNullable<AnalysisRun['result']>): void {
  run.status = 'completed';
  run.stage = 'complete';
  run.finishedAtMs = Date.now();
  recordProgress(run, { stage: 'complete', message: 'Analysis complete', status: 'completed', percent: 100 });
  run.result = result;
}

export function failRun(run: AnalysisRun, code: string, message: string): void {
  run.status = 'failed';
  run.finishedAtMs = Date.now();
  run.error = { code, message };
}
