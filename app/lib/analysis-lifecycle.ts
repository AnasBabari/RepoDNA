import type { RepoDNAProject } from './types';

export const ANALYSIS_PROGRESS_STEPS = [
  'Connecting to repository source...',
  'Extracting source files and manifests...',
  'Breaking down symbols, routes, and data models...',
  'Resolving imports and execution call graphs...',
  'Checking route coverage and architecture consistency...',
  'Finalizing architecture map and metrics...',
] as const;

export const ANALYSIS_COMPLETE_STEP = ANALYSIS_PROGRESS_STEPS.length;

export class AnalysisCancelledError extends Error {
  constructor() {
    super('Analysis was cancelled.');
    this.name = 'AnalysisCancelledError';
  }
}

interface AnalysisLifecycleTiming {
  discoveryStepMs: number;
  verificationStepMs: number;
  completedStateMs: number;
}

interface AnalysisLifecycleOptions<T> {
  analyze: () => Promise<T>;
  validate: (result: T) => void | Promise<void>;
  onStep: (step: number) => void;
  signal?: AbortSignal;
  timing?: Partial<AnalysisLifecycleTiming>;
}

const DEFAULT_TIMING: AnalysisLifecycleTiming = {
  discoveryStepMs: 550,
  verificationStepMs: 550,
  completedStateMs: 350,
};

function throwIfCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new AnalysisCancelledError();
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) {
    throwIfCancelled(signal);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      reject(new AnalysisCancelledError());
    };

    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }, milliseconds);

    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}

function waitForOutcome<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfCancelled(signal);

  return new Promise((resolve, reject) => {
    const cancel = () => {
      signal.removeEventListener('abort', cancel);
      reject(new AnalysisCancelledError());
    };

    signal.addEventListener('abort', cancel, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', cancel);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', cancel);
        reject(error);
      }
    );
  });
}

/**
 * Runs analysis and the progress screen as one lifecycle. Fast repositories still
 * display every discovery and verification phase, while slow repositories remain
 * on graph resolution until their real analysis has completed.
 */
export async function runAnalysisLifecycle<T>({
  analyze,
  validate,
  onStep,
  signal,
  timing,
}: AnalysisLifecycleOptions<T>): Promise<T> {
  const durations = { ...DEFAULT_TIMING, ...timing };
  throwIfCancelled(signal);
  onStep(0);

  // Convert rejection into data immediately so a fast failure cannot become an
  // unhandled rejection while the opening progress phases are being displayed.
  const analysisOutcome = Promise.resolve()
    .then(analyze)
    .then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );

  for (let step = 1; step <= 3; step += 1) {
    await wait(durations.discoveryStepMs, signal);
    onStep(step);
  }

  const outcome = await waitForOutcome(analysisOutcome, signal);
  throwIfCancelled(signal);
  if (!outcome.ok) throw outcome.error;

  onStep(4);
  await Promise.resolve(validate(outcome.value));
  await wait(durations.verificationStepMs, signal);

  onStep(5);
  await wait(durations.verificationStepMs, signal);

  // Briefly show every stage as completed so the splash does not disappear while
  // its final line is still active.
  onStep(ANALYSIS_COMPLETE_STEP);
  await wait(durations.completedStateMs, signal);
  throwIfCancelled(signal);

  return outcome.value;
}

export interface ArchitectureAudit {
  valid: boolean;
  checks: number;
  issues: string[];
}

/**
 * Checks that the generated visual model is internally consistent before it is
 * rendered. This catches stale counters and graph references that would otherwise
 * produce a polished but misleading architecture map.
 */
export function auditArchitectureConsistency(project: RepoDNAProject): ArchitectureAudit {
  const issues: string[] = [];
  let checks = 0;
  const check = (condition: boolean, message: string) => {
    checks += 1;
    if (!condition) issues.push(message);
  };

  const filePaths = new Set(project.files.map((file) => file.path));
  const fileIds = new Set(project.files.map((file) => file.id));
  const componentIds = new Set(project.architecture.components.map((component) => component.id));

  check(filePaths.size === project.files.length, 'File paths must be unique.');
  check(fileIds.size === project.files.length, 'File identifiers must be unique.');
  check(project.repository.fileCount === project.files.length, 'Repository file count does not match the analyzed file list.');
  check(project.repository.sourceFileCount <= project.repository.fileCount, 'Source file count exceeds the repository file count.');
  check(
    project.repository.parsedFileCount === project.files.filter((file) => file.parsed).length,
    'Parsed file count does not match the analyzed file records.'
  );
  check(project.metrics.symbols === project.symbols.length, 'Symbol metric does not match extracted symbols.');
  check(project.metrics.routes === project.routes.length, 'Route metric does not match extracted routes.');
  check(project.metrics.components === project.architecture.components.length, 'Component metric does not match architecture components.');

  project.symbols.forEach((symbol) => check(filePaths.has(symbol.file), `Symbol ${symbol.id} references a missing file: ${symbol.file}`));
  project.routes.forEach((route) => check(filePaths.has(route.file), `Route ${route.id} references a missing file: ${route.file}`));
  project.entrypoints.forEach((entrypoint) => check(filePaths.has(entrypoint.file), `Entrypoint ${entrypoint.id} references a missing file: ${entrypoint.file}`));

  project.imports.forEach((record) => {
    check(filePaths.has(record.source), `Import ${record.id} references a missing source file: ${record.source}`);
    if (!record.external && record.target) {
      check(filePaths.has(record.target), `Import ${record.id} resolves to a missing file: ${record.target}`);
    }
  });

  project.architecture.components.forEach((component) => {
    component.files.forEach((file) => check(filePaths.has(file), `Component ${component.id} references a missing file: ${file}`));
  });

  project.architecture.connections.forEach((connection) => {
    check(componentIds.has(connection.source), `Architecture connection ${connection.id} has a missing source component.`);
    check(componentIds.has(connection.target), `Architecture connection ${connection.id} has a missing target component.`);
  });

  project.flows.forEach((flow) => {
    const nodeIds = new Set(flow.nodes.map((node) => node.id));
    check(nodeIds.size === flow.nodes.length, `Execution flow ${flow.id} contains duplicate node identifiers.`);
    flow.nodes.forEach((node) => check(filePaths.has(node.file), `Execution flow ${flow.id} references a missing file: ${node.file}`));
    flow.edges.forEach((edge) => {
      check(nodeIds.has(edge.source), `Execution flow ${flow.id} has an edge with a missing source node.`);
      check(nodeIds.has(edge.target), `Execution flow ${flow.id} has an edge with a missing target node.`);
    });
  });

  Object.entries(project.metadata.fileComponents).forEach(([file, component]) => {
    check(filePaths.has(file), `Architecture assignment references a missing file: ${file}`);
    check(componentIds.has(component), `Architecture assignment for ${file} references a missing component: ${component}`);
  });

  return { valid: issues.length === 0, checks, issues };
}

export function assertArchitectureConsistency(project: RepoDNAProject): void {
  const audit = auditArchitectureConsistency(project);
  if (!audit.valid) {
    const visibleIssues = audit.issues.slice(0, 4).join(' ');
    const remainder = audit.issues.length > 4 ? ` (${audit.issues.length - 4} more)` : '';
    throw new Error(`Architecture consistency check failed: ${visibleIssues}${remainder}`);
  }
}
