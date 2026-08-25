import { getRun } from 'workflow/api';

import { createApiErrorResponse } from '../../../../../lib/api-error';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;

  try {
    const run = getRun(runId);
    if (!(await run.exists)) {
      return createApiErrorResponse('RUN_NOT_FOUND', 'Unknown or expired analysis run.', 404);
    }

    const rawStartIndex = new URL(request.url).searchParams.get('startIndex');
    const parsedStartIndex = rawStartIndex === null ? 0 : Number.parseInt(rawStartIndex, 10);
    const startIndex = Number.isSafeInteger(parsedStartIndex) && parsedStartIndex >= 0
      ? parsedStartIndex
      : 0;
    const stream = run.getReadable<string>({ startIndex });
    const tailIndex = await stream.getTailIndex();

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-RepoDNA-Start-Index': String(startIndex),
        'X-RepoDNA-Tail-Index': String(tailIndex),
      },
    });
  } catch {
    return createApiErrorResponse('RUN_NOT_FOUND', 'Unknown or expired analysis run.', 404);
  }
}
