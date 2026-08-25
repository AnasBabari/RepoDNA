import { del, get } from '@vercel/blob';
import { getRun } from 'workflow/api';

import { createApiErrorResponse } from '../../../../../lib/api-error';
import type { PublicAnalysisWorkflowResult } from '../../../../../workflows/analyze-public-repository';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;

  try {
    const run = getRun<PublicAnalysisWorkflowResult>(runId);
    if (!(await run.exists)) {
      return createApiErrorResponse('RUN_NOT_FOUND', 'Unknown or expired analysis run.', 404);
    }
    const status = await run.status;
    if (status !== 'completed') {
      return createApiErrorResponse(
        status === 'failed' ? 'WORKFLOW_FAILED' : 'ANALYSIS_NOT_READY',
        status === 'failed' ? 'The durable analysis failed.' : 'The analysis artifact is not ready yet.',
        status === 'failed' ? 502 : 409
      );
    }

    const result = await run.returnValue;
    if (Date.parse(result.artifact.expiresAt) <= Date.now()) {
      await del(result.artifact.pathname).catch(() => undefined);
      return createApiErrorResponse('ARTIFACT_EXPIRED', 'This cached analysis artifact has expired.', 410);
    }

    const blob = await get(result.artifact.pathname, { access: 'private' });
    if (!blob || blob.statusCode !== 200) {
      return createApiErrorResponse('ARTIFACT_NOT_FOUND', 'The analysis artifact is unavailable.', 404);
    }

    return new Response(blob.stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${result.repository.name}-repodna-v2.json"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return createApiErrorResponse('RUN_NOT_FOUND', 'Unknown or expired analysis run.', 404);
  }
}
