import { NextRequest, NextResponse } from 'next/server';
import { getRun, start } from 'workflow/api';

import { createApiErrorResponse } from '../../../lib/api-error';
import { isJsonBodyTooLarge, readBoundedJson } from '../../../lib/bounded-json';
import { parseGitHubUrl } from '../../../lib/analyzer';
import { isPublicArtifactCacheConfigured } from '../../../lib/analyzer/v2/artifact-cache';
import { auth } from '../../../lib/auth';
import { checkAnalysisRateLimit } from '../../../lib/ratelimit';
import {
  analyzePublicRepositoryWorkflow,
  type PublicAnalysisWorkflowResult,
} from '../../../workflows/analyze-public-repository';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, private, max-age=0',
  'X-Content-Type-Options': 'nosniff',
};

async function resolveCommitSha(owner: string, name: string): Promise<string | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${name}/commits/HEAD`, {
      headers: { 'User-Agent': 'RepoDNA-V2/2.0', Accept: 'application/vnd.github.v3+json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { sha?: string };
    return typeof data.sha === 'string' && data.sha.length >= 7 ? data.sha : null;
  } catch {
    return null;
  }
}
function runEndpoints(runId: string) {
  return {
    statusEndpoint: `/api/v2/analyses/${runId}`,
    eventsEndpoint: `/api/v2/analyses/${runId}/events`,
    artifactEndpoint: `/api/v2/analyses/${runId}/artifact`,
  };
}

async function runStatus(runId: string) {
  const run = getRun<PublicAnalysisWorkflowResult>(runId);
  if (!(await run.exists)) return null;

  const [status, createdAt, startedAt, completedAt] = await Promise.all([
    run.status,
    run.createdAt,
    run.startedAt,
    run.completedAt,
  ]);
  const result = status === 'completed' ? await run.returnValue : null;

  return {
    runId,
    status,
    createdAt: createdAt.toISOString(),
    startedAt: startedAt?.toISOString() ?? null,
    completedAt: completedAt?.toISOString() ?? null,
    ...runEndpoints(runId),
    result: result
      ? {
          repository: result.repository,
          commitSha: result.commitSha,
          ...result.summary,
          artifactExpiresAt: result.artifact.expiresAt,
          cacheHit: result.artifact.cacheHit,
        }
      : null,
    error:
      status === 'failed'
        ? { code: 'WORKFLOW_FAILED', message: 'The durable repository analysis failed. See the final progress event for details.' }
        : status === 'cancelled'
          ? { code: 'WORKFLOW_CANCELLED', message: 'The durable repository analysis was cancelled.' }
          : null,
  };
}

export async function POST(request: NextRequest) {
  let session = null;
  try {
    session = await auth();
  } catch {
    // Public analysis remains available without a session.
  }

  const rawIp =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('x-real-ip')?.trim() ??
    '127.0.0.1';

  try {
    const rateLimit = await checkAnalysisRateLimit({ ip: rawIp, userId: session?.user?.id });
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
    bodyUrl = (await readBoundedJson<{ url?: unknown }>(request))?.url;
  } catch (error) {
    if (isJsonBodyTooLarge(error)) {
      return createApiErrorResponse('PAYLOAD_TOO_LARGE', 'Request body exceeds the 16 KB limit.', 413);
    }
    return createApiErrorResponse('INVALID_REQUEST', 'Body must be JSON with a "url" field.', 400);
  }
  if (typeof bodyUrl !== 'string' || !bodyUrl.trim()) {
    return createApiErrorResponse('INVALID_REQUEST', 'Missing repository URL.', 400);
  }

  const parsed = parseGitHubUrl(bodyUrl.trim());
  if (!parsed) {
    return createApiErrorResponse('INVALID_GITHUB_URL', 'Invalid GitHub repository URL.', 400);
  }
  const repositoryUrl = `https://github.com/${parsed.owner}/${parsed.repo}`;

  if (!isPublicArtifactCacheConfigured()) {
    return createApiErrorResponse(
      'PUBLIC_ARTIFACT_CACHE_NOT_CONFIGURED',
      'Durable deep analysis is not configured on this deployment.',
      503,
      { fallbackAvailable: true }
    );
  }

  const commitSha = await resolveCommitSha(parsed.owner, parsed.repo);
  if (!commitSha) {
    return createApiErrorResponse(
      'UPSTREAM_GITHUB_ERROR',
      'Could not resolve the public repository HEAD commit.',
      502,
      { fallbackAvailable: true }
    );
  }

  try {
    // Only public identity is serialized into the durable workflow. OAuth/App
    // tokens are intentionally never passed to Workflow or Blob storage.
    const run = await start(analyzePublicRepositoryWorkflow, [
      {
        repositoryUrl,
        owner: parsed.owner,
        repo: parsed.repo,
        commitSha,
      },
    ]);

    return NextResponse.json(
      {
        runId: run.runId,
        status: 'pending',
        executionMode: 'workflow',
        repository: { owner: parsed.owner, name: parsed.repo, url: repositoryUrl },
        commitSha,
        ...runEndpoints(run.runId),
      },
      { status: 202, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error('[RepoDNA:WorkflowStartFailed]', error);
    return createApiErrorResponse(
      'WORKFLOW_START_FAILED',
      'Could not start durable repository analysis.',
      503,
      { fallbackAvailable: true }
    );
  }
}

/** Backwards-compatible query status; the canonical endpoint is /[runId]. */
export async function GET(request: NextRequest) {
  const runId = request.nextUrl.searchParams.get('runId');
  if (!runId) return createApiErrorResponse('INVALID_REQUEST', 'Missing runId.', 400);

  try {
    const status = await runStatus(runId);
    return status
      ? NextResponse.json(status, { headers: NO_STORE_HEADERS })
      : createApiErrorResponse('RUN_NOT_FOUND', 'Unknown or expired analysis run.', 404);
  } catch {
    return createApiErrorResponse('RUN_NOT_FOUND', 'Unknown or expired analysis run.', 404);
  }
}
