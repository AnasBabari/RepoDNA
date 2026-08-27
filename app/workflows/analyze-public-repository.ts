import { FatalError, getWritable } from 'workflow';

import { type AnalyzeProgress } from '../lib/analyzer';
import { fetchGitHubRepo } from '../lib/analyzer/ingestion';
import { IngestionError, PUBLIC_REPOSITORY_INGESTION_LIMITS } from '../lib/analyzer/types';
import {
  isPublicArtifactCacheConfigured,
  readCachedPublicArtifact,
  storePublicArtifact,
  type PublicArtifactPointer,
  type PublicArtifactSummary,
} from '../lib/analyzer/v2/artifact-cache';
import { analyzeRepositoryV2 } from '../lib/analyzer/v2/pipeline';
import type { RunStage } from '../lib/analyzer/v2/runs';
import { validateArtifact } from '../lib/schema/artifact-loader';
import { recordScannedPublicRepository } from '../lib/stats/scanned-repositories';

export interface PublicAnalysisWorkflowInput {
  repositoryUrl: string;
  owner: string;
  repo: string;
  commitSha: string;
}
export interface PublicAnalysisWorkflowResult {
  repository: { owner: string; name: string; url: string };
  commitSha: string;
  summary: PublicArtifactSummary;
  artifact: PublicArtifactPointer;
}

export interface DurableAnalysisProgress {
  seq: number;
  status: 'running' | 'completed' | 'failed';
  stage: RunStage;
  percent: number;
  message: string;
  code?: string;
}

async function writeProgress(event: DurableAnalysisProgress): Promise<void> {
  'use step';

  const writer = getWritable<string>().getWriter();
  try {
    await writer.write(`${JSON.stringify(event)}\n`);
  } finally {
    writer.releaseLock();
  }
}

async function analyzeAndCachePublicRepository(
  input: PublicAnalysisWorkflowInput
): Promise<PublicAnalysisWorkflowResult> {
  'use step';

  if (!isPublicArtifactCacheConfigured()) {
    throw new FatalError(
      'PUBLIC_ARTIFACT_CACHE_NOT_CONFIGURED: Vercel Blob is required for durable public analysis.'
    );
  }

  const writer = getWritable<string>().getWriter();
  let seq = 1;
  const emit = async (
    stage: RunStage,
    percent: number,
    message: string,
    status: DurableAnalysisProgress['status'] = 'running'
  ) => {
    await writer.write(`${JSON.stringify({ seq: seq++, status, stage, percent, message })}\n`);
  };

  try {
    await emit('resolve', 2, `Resolved ${input.owner}/${input.repo} at ${input.commitSha.slice(0, 7)}`);

    const cached = await readCachedPublicArtifact(input);
    if (cached) {
      await emit('complete', 100, 'Loaded a validated analysis from the seven-day public cache', 'completed');
      // Record unique public repository — idempotent via SADD. Never fails the analysis.
      try {
        await recordScannedPublicRepository(input.owner, input.repo);
      } catch {}
      return {
        repository: { owner: input.owner, name: input.repo, url: input.repositoryUrl },
        commitSha: input.commitSha,
        summary: cached.summary,
        artifact: cached.pointer,
      };
    }

    await emit('download', 8, 'Fetching public repository sources (archive or Git tree)');
    // Deliberately omit credentials: durable workflows are public-only. Private
    // repository source files never enter Workflow or Blob storage.
    const discovery = await fetchGitHubRepo(
      input.repositoryUrl,
      PUBLIC_REPOSITORY_INGESTION_LIMITS,
      undefined,
      { commitSha: input.commitSha }
    );
    const inventory = discovery.inventory;
    await emit(
      'inventory',
      18,
      `Inventoried ${inventory?.totalFileCount ?? discovery.files.length} files; parsing ${inventory?.firstPartySourceFileCount ?? discovery.files.length} first-party source files${inventory?.acquisitionMode === 'git-tree' ? ' with large-repository Git tree mode' : ''}`
    );

    await emit('parse', 24, 'Extracting symbols, routes, imports, calls, models, and dependencies');
    let lastAnalysisPercent = 24;
    const emitAnalysisProgress = async (progress: AnalyzeProgress): Promise<void> => {
      const ranges: Record<AnalyzeProgress['stage'], [number, number]> = {
        parse: [25, 58],
        resolve_relationships: [59, 77],
        analytics: [78, 89],
      };
      const [startPercent, endPercent] = ranges[progress.stage];
      const ratio = progress.total > 0 ? Math.min(1, Math.max(0, progress.completed / progress.total)) : 1;
      const percent = Math.max(lastAnalysisPercent, Math.round(startPercent + (endPercent - startPercent) * ratio));
      if (percent === lastAnalysisPercent && progress.completed < progress.total) return;
      lastAnalysisPercent = percent;
      await emit(progress.stage, percent, progress.message);
    };
    const project = await analyzeRepositoryV2(
      { ...discovery, inventory },
      {
        commitSha: input.commitSha,
        analyzedRef: 'HEAD',
        ingestionLimits: PUBLIC_REPOSITORY_INGESTION_LIMITS,
        onProgress: emitAnalysisProgress,
      }
    );

    await emit('resolve_relationships', Math.max(lastAnalysisPercent, 77), 'Resolving cross-file relationships and unresolved evidence');
    await emit('analytics', Math.max(lastAnalysisPercent, 89), 'Computing communities, dependency cycles, centrality, and completeness');

    const validation = validateArtifact(project);
    if (!validation.valid || validation.version !== '2.0.0') {
      throw new FatalError('ANALYSIS_SCHEMA_ERROR: Generated v2 artifact failed validation.');
    }
    await emit('validate', 94, 'Validated the RepoDNA v2 graph contract');

    const stored = await storePublicArtifact({
      owner: input.owner,
      repo: input.repo,
      commitSha: input.commitSha,
      project,
    });
    // Telemetry: increment durable public scan counter only after a validated artifact is durably stored.
    try {
      await recordScannedPublicRepository(input.owner, input.repo);
    } catch {}
    await emit('complete', 100, 'Analysis complete and cached privately for seven days', 'completed');

    return {
      repository: { owner: input.owner, name: input.repo, url: input.repositoryUrl },
      commitSha: input.commitSha,
      summary: stored.summary,
      artifact: stored.pointer,
    };
  } catch (error) {
    if (error instanceof FatalError) throw error;
    if (error instanceof IngestionError && error.status < 500) {
      throw new FatalError(`${error.code}: ${error.message}`);
    }
    throw error;
  } finally {
    writer.releaseLock();
  }
}

export async function analyzePublicRepositoryWorkflow(
  input: PublicAnalysisWorkflowInput
): Promise<PublicAnalysisWorkflowResult> {
  'use workflow';

  try {
    return await analyzeAndCachePublicRepository(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ANALYSIS_FAILED: Public analysis failed.';
    const code = message.includes(':') ? message.slice(0, message.indexOf(':')) : 'ANALYSIS_FAILED';
    await writeProgress({
      seq: 999,
      status: 'failed',
      stage: 'complete',
      percent: 100,
      message: message.includes(':') ? message.slice(message.indexOf(':') + 1).trim() : message,
      code,
    });
    throw error;
  }
}
