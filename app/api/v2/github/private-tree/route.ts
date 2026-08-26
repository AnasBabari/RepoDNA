import { NextRequest, NextResponse } from 'next/server';

import { createApiErrorResponse } from '../../../../lib/api-error';
import { parseGitHubUrl } from '../../../../lib/analyzer';
import { fetchGitHubRepo } from '../../../../lib/analyzer/ingestion';
import { DEFAULT_INGESTION_LIMITS, IngestionError } from '../../../../lib/analyzer/types';
import { auth } from '../../../../lib/auth';
import { getGitHubAccessToken } from '../../../../lib/github-session';

export const dynamic = 'force-dynamic';

/**
 * Authenticated source transfer for repositories whose generated ZIP archive
 * is larger than the bounded archive path can accept.
 *
 * The route returns only filtered source/configuration files. GitHub tokens
 * remain server-side, the response is never cached, and the browser worker
 * owns the returned source only for the lifetime of the analysis tab.
 */
export async function POST(request: NextRequest) {
  let accessToken: string | undefined;
  try {
    await auth();
    accessToken = await getGitHubAccessToken(request);
  } catch {
    // treated as unauthenticated below
  }

  if (!accessToken) {
    return NextResponse.json(
      { code: 'GITHUB_AUTH_REQUIRED', message: 'Connect GitHub to analyze private repositories.' },
      { status: 401, headers: { 'Cache-Control': 'no-store, private, max-age=0' } }
    );
  }

  let bodyUrl: unknown;
  try {
    bodyUrl = ((await request.json()) as { url?: unknown })?.url;
  } catch {
    return createApiErrorResponse('INVALID_REQUEST', 'Body must be JSON with a "url" field.', 400);
  }
  if (typeof bodyUrl !== 'string') {
    return createApiErrorResponse('INVALID_REQUEST', 'Missing repository URL.', 400);
  }

  const parsed = parseGitHubUrl(bodyUrl.trim());
  if (!parsed) return createApiErrorResponse('INVALID_GITHUB_URL', 'Invalid GitHub repository URL.', 400);

  try {
    const discovery = await fetchGitHubRepo(
      `https://github.com/${parsed.owner}/${parsed.repo}`,
      DEFAULT_INGESTION_LIMITS,
      accessToken
    );

    return NextResponse.json(
      {
        files: discovery.files,
        skipped: discovery.skipped,
        name: discovery.name,
        source: `private:${discovery.name}`,
        inventory: discovery.inventory,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, private, max-age=0',
          'X-Content-Type-Options': 'nosniff',
          Pragma: 'no-cache',
        },
      }
    );
  } catch (error) {
    if (error instanceof IngestionError) {
      return createApiErrorResponse(error.code, error.message, error.status, {
        fallbackAvailable: error.code === 'UPSTREAM_GITHUB_RATE_LIMITED' || error.code === 'UPSTREAM_GITHUB_ERROR',
      });
    }
    return createApiErrorResponse('ARCHIVE_FETCH_FAILED', 'Could not fetch repository source files.', 502);
  }
}
