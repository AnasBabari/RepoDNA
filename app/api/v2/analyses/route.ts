import { NextRequest, NextResponse } from 'next/server';

import { createApiErrorResponse } from '../../../lib/api-error';
import { checkAnalysisRateLimit } from '../../../lib/ratelimit';
import { parseGitHubUrl } from '../../../lib/analyzer';
import { fetchGitHubRepo } from '../../../lib/analyzer/ingestion';
import { DEFAULT_INGESTION_LIMITS } from '../../../lib/analyzer/types';
import { analyzeRepositoryV2 } from '../../../lib/analyzer/v2/pipeline';
import { completeRun, createRun, failRun, getRun, recordProgress } from '../../../lib/analyzer/v2/runs';
import { auth } from '../../../lib/auth';
import { getGitHubAccessToken } from '../../../lib/github-session';
import { validateArtifact } from '../../../lib/schema/artifact-loader';

export const dynamic = 'force-dynamic';

/**
 * Public-repository v2 analyses.
 *
 * - candidate files <= 250 and candidate text <= 5 MB: executed inline.
 * - above either threshold: returns 202 WORKFLOW_REQUIRED with the runId;
 *   durable workflow execution requires Vercel Workflow configuration and is
 *   reported honestly rather than silently degrading.
 */

const INLINE_MAX_CANDIDATE_FILES = 250;
const INLINE_MAX_CANDIDATE_BYTES = 5 * 1024 * 1024;

async function resolveCommitSha(owner: string, name: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}/commits/HEAD`, {
      headers: { 'User-Agent': 'RepoDNA-V2/2.0', Accept: 'application/vnd.github.v3+json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { sha?: string };
    return typeof data.sha === 'string' ? data.sha : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  let session = null;
  let accessToken: string | undefined;
  try {
    session = await auth();
    accessToken = await getGitHubAccessToken(request);
  } catch {
    // graceful unauthenticated fallback
  }
  const userId = session?.user?.id;

  const rawIp =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('x-real-ip')?.trim() ??
    '127.0.0.1';

  try {
    const rateLimit = await checkAnalysisRateLimit({ ip: rawIp, userId });
    if (!rateLimit.allowed) {
      return createApiErrorResponse('RATE_LIMITED', 'Too many analysis requests.', 429, {
        retryAfter: rateLimit.retryAfter ?? 60,
      });
    }
  } catch {
    return createApiErrorResponse(
      'RATE_LIMIT_UNAVAILABLE',
      'Rate-limit infrastructure unavailable.',
      503,
      { fallbackAvailable: true }
    );
  }

  let bodyUrl: unknown;
  try {
    bodyUrl = (await request.json() as { url?: unknown })?.url;
  } catch {
    return createApiErrorResponse('INVALID_REQUEST', 'Body must be JSON with a "url" field.', 400);
  }
  if (typeof bodyUrl !== 'string' || !bodyUrl.trim()) {
    return createApiErrorResponse('INVALID_REQUEST', 'Missing repository URL.', 400);
  }
  const parsed = parseGitHubUrl(bodyUrl.trim());
  if (!parsed) {
    return createApiErrorResponse('INVALID_GITHUB_URL', 'Invalid GitHub repository URL.', 400);
  }

  const commitSha = await resolveCommitSha(parsed.owner, parsed.repo);
  const run = createRun({ owner: parsed.owner, name: parsed.repo, url: bodyUrl.trim(), commitSha });

  recordProgress(run, {
    stage: 'resolve',
    message: `Resolving ${parsed.owner}/${parsed.repo}${commitSha ? ` at ${commitSha.slice(0, 7)}` : ''}`,
  });

  try {
    recordProgress(run, { stage: 'download', message: 'Downloading repository archive' });
    // Public ingestion prefers unauthenticated codeload; an expired optional
    // session token can never break a public analysis here.
    const discovery = await fetchGitHubRepo(bodyUrl.trim(), DEFAULT_INGESTION_LIMITS, accessToken);
    const inventory = discovery.inventory ?? {
      totalFileCount: discovery.files.length,
      totalBytes: 0,
      firstPartySourceFileCount: discovery.files.length,
      candidateFileCount: discovery.files.length,
      ignoredFileCount: 0,
      generatedFileCount: 0,
      unsupportedSourceFileCount: 0,
      totalArchiveEntries: discovery.files.length,
      skippedByReason: {},
    };

    recordProgress(run, {
      stage: 'inventory',
      message: `Inventorying ${inventory.totalFileCount} repository files`,
      completedWork: 0,
      totalWork: inventory.candidateFileCount,
      percent: 5,
    });

    const tooLarge =
      inventory.candidateFileCount > INLINE_MAX_CANDIDATE_FILES ||
      inventory.totalBytes > INLINE_MAX_CANDIDATE_BYTES ||
      inventory.firstPartySourceFileCount > INLINE_MAX_CANDIDATE_FILES;

    if (tooLarge) {
      recordProgress(run, {
        stage: 'inventory',
        status: 'failed',
        message:
          'Repository exceeds inline thresholds; durable workflow execution required for full analysis.',
      });
      failRun(
        run,
        'WORKFLOW_REQUIRED',
        'This repository exceeds the inline limits of 250 candidate source files or 5 MB of candidate text. Durable large-repository analysis requires configured Vercel Workflow infrastructure; use the standard analysis endpoint meanwhile.'
      );
      return NextResponse.json(
        {
          runId: run.runId,
          status: 'workflow_required',
          code: 'WORKFLOW_REQUIRED',
          inventory: inventory,
          message: run.error?.message,
        },
        { status: 202 }
      );
    }

    recordProgress(run, {
      stage: 'parse',
      message: `Parsing ${inventory.firstPartySourceFileCount} first-party source files`,
      totalWork: inventory.candidateFileCount,
      completedWork: 0,
      percent: 10,
    });

    const project = await analyzeRepositoryV2(
      { ...discovery, inventory },
      { commitSha }
    );

    recordProgress(run, {
      stage: 'resolve_relationships',
      message: 'Resolving imports and function calls',
      percent: 60,
    });
    recordProgress(run, {
      stage: 'analytics',
      message: 'Detecting communities and dependency cycles',
      percent: 80,
    });

    const validation = validateArtifact(project);
    if (!validation.valid) {
      throw new Error('Generated artifact failed schema validation');
    }
    recordProgress(run, { stage: 'validate', message: 'Validating graph contract', percent: 95 });

    completeRun(run, {
      schemaVersion: project.schemaVersion,
      coveragePercentage: project.coverage.percentage,
      nodeCount: project.nodes.length,
      edgeCount: project.edges.length,
      unresolvedCount: project.unresolved.length,
      completeness: project.completeness,
      project,
    });

    return NextResponse.json(
      {
        runId: run.runId,
        status: 'completed',
        executionMode: 'inline',
        commitSha,
        inventory: inventory,
        coveragePercentage: project.coverage.percentage,
        nodeCount: project.nodes.length,
        edgeCount: project.edges.length,
        unresolvedCount: project.unresolved.length,
        completeness: project.completeness,
        eventsEndpoint: `/api/v2/analyses/${run.runId}/events`,
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Analysis failed';
    failRun(run, 'ANALYSIS_FAILED', message);
    return createApiErrorResponse('ANALYSIS_FAILED', 'Repository analysis failed.', 502, {
      requestId: run.runId,
    });
  }
}

export async function GET(request: NextRequest) {
  const runId = request.nextUrl.searchParams.get('runId') ?? request.nextUrl.pathname.split('/').pop();
  if (!runId) {
    return createApiErrorResponse('INVALID_REQUEST', 'Missing runId.', 400);
  }
  const run = getRun(runId);
  if (!run) {
    return createApiErrorResponse('RUN_NOT_FOUND', 'Unknown or expired analysis run.', 404);
  }
  return NextResponse.json({
    runId: run.runId,
    status: run.status === 'completed' && !run.result ? 'running' : run.status,
    stage: run.stage,
    repository: { owner: run.repository.owner, name: run.repository.name },
    commitSha: run.repository.commitSha,
    elapsedMs: (run.finishedAtMs ?? Date.now()) - run.createdAt,
    latestEvent: run.events[run.events.length - 1] ?? null,
    result: run.status === 'completed'
      ? {
          schemaVersion: run.result?.schemaVersion,
          coveragePercentage: run.result?.coveragePercentage,
          nodeCount: run.result?.nodeCount,
          edgeCount: run.result?.edgeCount,
          unresolvedCount: run.result?.unresolvedCount,
          completeness: run.result?.completeness,
        }
      : null,
    error: run.error,
  });
}
