import { NextRequest, NextResponse } from 'next/server';
import { del, list } from '@vercel/blob';

import { PUBLIC_ARTIFACT_TTL_SECONDS } from '../../../lib/analyzer/v2/artifact-cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BLOBS_PER_RUN = 5000;
const BATCH_SIZE = 100;
const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, private, max-age=0',
  'X-Content-Type-Options': 'nosniff',
};

export async function GET(request: NextRequest) {
  return handleCleanup(request);
}

export async function POST(request: NextRequest) {
  return handleCleanup(request);
}

async function handleCleanup(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ code: 'CRON_SECRET_NOT_CONFIGURED', message: 'Cron secret is not configured.' }, { status: 503, headers: NO_STORE_HEADERS });
  }

  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${cronSecret}`;
  if (authHeader !== expected) {
    return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Invalid cron token.' }, { status: 401, headers: NO_STORE_HEADERS });
  }

  try {
    let cursor: string | undefined;
    let processed = 0;
    let deletedCanonical = 0;
    let deletedExports = 0;
    let failedDeletions = 0;
    let failedBatches = 0;
    const now = Date.now();

    do {
      const result = await list({ prefix: 'repodna/public/', limit: 1000, cursor } as unknown as never);
      const blobs = (result as unknown as { blobs: Array<{ pathname: string; uploadedAt: Date | string; url: string }> }).blobs ?? [];
      cursor = (result as unknown as { cursor?: string }).cursor;

      const toDelete: string[] = [];
      for (const blob of blobs) {
        if (processed >= MAX_BLOBS_PER_RUN) break;
        processed++;
        const pathname = blob.pathname;
        const uploadedAt = blob.uploadedAt instanceof Date ? blob.uploadedAt : new Date(blob.uploadedAt as string);

        if (pathname.endsWith('/repodna-v2.json')) {
          const expiresAt = uploadedAt.getTime() + PUBLIC_ARTIFACT_TTL_SECONDS * 1000;
          if (expiresAt <= now) toDelete.push(pathname);
        } else if (pathname.includes('/exports/1.0.0/')) {
          const match = pathname.match(/\/expires-(\d+)\//);
          if (match) {
            const epoch = Number(match[1]);
            if (Number.isFinite(epoch) && epoch <= now) toDelete.push(pathname);
          }
        }
      }

      for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
        const batch = toDelete.slice(i, i + BATCH_SIZE);
        try {
          await del(batch);
          for (const pathname of batch) {
            if (pathname.endsWith('/repodna-v2.json')) deletedCanonical++;
            else deletedExports++;
          }
        } catch {
          // Failed batches are reported honestly instead of being counted as
          // deleted. Blob pathnames, tokens, and exception text are never
          // included in responses.
          failedBatches++;
          failedDeletions += batch.length;
        }
      }

      if (processed >= MAX_BLOBS_PER_RUN) break;
      if (!cursor) break;
    } while (true);

    return NextResponse.json({
      processed,
      deletedCanonical,
      deletedExports,
      deletedTotal: deletedCanonical + deletedExports,
      failedDeletions,
      failedBatches,
    }, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({ code: 'CLEANUP_FAILED', message: 'Cleanup failed.' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
