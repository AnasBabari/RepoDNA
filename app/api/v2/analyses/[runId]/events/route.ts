import { NextRequest } from 'next/server';

import { getRun, type AnalysisRun } from '../../../../../lib/analyzer/v2/runs';
import { createApiErrorResponse } from '../../../../../lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * Reconnectable progress event stream for a v2 analysis run.
 * Uses Server-Sent Events; events recorded by the run registry are replayed
 * from the beginning so refreshes resume with full history.
 */

function streamFor(run: AnalysisRun, request: NextRequest): Response {
  const encoder = new TextEncoder();
  let cursor = 0;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: unknown, event: string = 'progress') => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };

      send({ runId: run.runId, status: run.status }, 'open');

      const tick = () => {
        while (cursor < run.events.length) {
          send(run.events[cursor]);
          cursor += 1;
        }
        if (run.status === 'completed' || run.status === 'failed') {
          send(
            { status: run.status, error: run.error },
            run.status === 'failed' ? 'error' : 'done'
          );
          closed = true;
          controller.close();
          return true;
        }
        return false;
      };

      // Replay any already-recorded progress immediately.
      tick();

      const interval = setInterval(() => {
        try {
          if (tick()) {
            clearInterval(interval);
            return;
          }
          // Heartbeat keeps proxies from closing idle streams.
          if (!closed) controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          clearInterval(interval);
        }
      }, 500);

      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      });
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, must-revalidate',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const run = getRun(runId);
  if (!run) {
    return createApiErrorResponse('RUN_NOT_FOUND', 'Unknown or expired analysis run.', 404);
  }
  return streamFor(run, request);
}
