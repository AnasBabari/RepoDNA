import { NextResponse } from 'next/server';
import { getRun } from 'workflow/api';

import { createApiErrorResponse } from '../../../../lib/api-error';
import type { PublicAnalysisWorkflowResult } from '../../../../workflows/analyze-public-repository';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, private, max-age=0',
  'X-Content-Type-Options': 'nosniff',
};

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;

  try {
    const run = getRun<PublicAnalysisWorkflowResult>(runId);
    if (!(await run.exists)) {
      return createApiErrorResponse('RUN_NOT_FOUND', 'Unknown or expired analysis run.', 404);
    }

    const [status, createdAt, startedAt, completedAt] = await Promise.all([
      run.status,
      run.createdAt,
      run.startedAt,
      run.completedAt,
    ]);
    const result = status === 'completed' ? await run.returnValue : null;

    return NextResponse.json({
      runId,
      status,
      createdAt: createdAt.toISOString(),
      startedAt: startedAt?.toISOString() ?? null,
      completedAt: completedAt?.toISOString() ?? null,
      eventsEndpoint: `/api/v2/analyses/${runId}/events`,
      artifactEndpoint: `/api/v2/analyses/${runId}/artifact`,
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
          ? { code: 'WORKFLOW_FAILED', message: 'The durable analysis failed. See the final progress event for details.' }
          : status === 'cancelled'
            ? { code: 'WORKFLOW_CANCELLED', message: 'The durable analysis was cancelled.' }
            : null,
    }, { headers: NO_STORE_HEADERS });
  } catch {
    return createApiErrorResponse('RUN_NOT_FOUND', 'Unknown or expired analysis run.', 404);
  }
}
