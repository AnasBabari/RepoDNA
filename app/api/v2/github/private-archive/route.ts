import { NextRequest, NextResponse } from 'next/server';

import { createApiErrorResponse } from '../../../../lib/api-error';
import { isJsonBodyTooLarge, readBoundedJson } from '../../../../lib/bounded-json';
import { parseGitHubUrl } from '../../../../lib/analyzer';
import { auth } from '../../../../lib/auth';
import { getGitHubAccessToken } from '../../../../lib/github-session';

export const dynamic = 'force-dynamic';

/**
 * Authenticated private-repository archive streaming for browser-worker analysis.
 *
 * Security invariants:
 * - requires an authenticated session with a GitHub access token;
 * - verifies the token can read the repository before streaming anything;
 * - streams at most maxArchiveBytes into a bounded buffer held only for the
 *   lifetime of this response;
 * - responds with no-store/private cache headers so no intermediary retains it;
 * - never logs repository names, paths, or source content;
 * - nothing is persisted server-side: the browser worker discards the buffer
 *   after parsing and the resulting graph lives only in the tab's memory.
 */

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, private, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  Pragma: 'no-cache',
};

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
      {
        code: 'GITHUB_AUTH_REQUIRED',
        message: 'Connect GitHub to analyze private repositories.',
      },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS }
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
  if (typeof bodyUrl !== 'string') {
    return createApiErrorResponse('INVALID_REQUEST', 'Missing repository URL.', 400);
  }
  const parsed = parseGitHubUrl(bodyUrl.trim());
  if (!parsed) {
    return createApiErrorResponse('INVALID_GITHUB_URL', 'Invalid GitHub repository URL.', 400);
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'RepoDNA-PrivateArchive/2.0',
  };

  // Verify least-privilege readability before streaming anything.
  try {
    const metaRes = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (metaRes.status === 401) {
      return NextResponse.json(
        {
          code: 'GITHUB_TOKEN_EXPIRED',
          message: 'Your GitHub session is no longer valid. Reconnect GitHub to continue.',
          reconnectRequired: true,
        },
        { status: 401, headers: PRIVATE_NO_STORE_HEADERS }
      );
    }
    if (metaRes.status === 403 || metaRes.status === 404) {
      const rateRemaining = metaRes.headers.get('x-ratelimit-remaining');
      const isRateLimited = metaRes.status === 403 && rateRemaining === '0';
      return NextResponse.json(
        isRateLimited
          ? { code: 'GITHUB_RATE_LIMITED', message: 'GitHub API rate limit reached. Retry shortly.' }
          : {
              code: 'GITHUB_FORBIDDEN',
              message:
                'RepoDNA does not have access to this repository. Select it in the GitHub App installation settings.',
              installSettingsUrl: `https://github.com/apps/${process.env.GITHUB_APP_SLUG ?? 'repodna'}/installations/select_target`,
            },
        { status: isRateLimited ? 429 : 403, headers: PRIVATE_NO_STORE_HEADERS }
      );
    }
    if (!metaRes.ok) {
      return createApiErrorResponse('GITHUB_UNAVAILABLE', 'GitHub is temporarily unavailable.', 502);
    }
  } catch {
    return createApiErrorResponse('GITHUB_UNAVAILABLE', 'Failed to reach GitHub.', 502);
  }

  // Stream the bounded archive through to the client without persisting it.
  try {
    const upstream = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/zipball/HEAD`,
      { headers, cache: 'no-store', signal: AbortSignal.timeout(60000) }
    );
    if (!upstream.ok || !upstream.body) {
      return createApiErrorResponse('ARCHIVE_FETCH_FAILED', 'Could not fetch repository archive.', 502);
    }

    const reader = upstream.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ARCHIVE_BYTES) {
        await reader.cancel();
        return createApiErrorResponse('ARCHIVE_TOO_LARGE', 'Repository archive exceeds the analysis size limit.', 413);
      }
      chunks.push(value);
    }

    const archive = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      archive.set(chunk, offset);
      offset += chunk.byteLength;
    }
    chunks.length = 0; // release intermediate buffers promptly

    return new NextResponse(new Uint8Array(archive), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(total),
        ...PRIVATE_NO_STORE_HEADERS,
      },
    });
  } catch {
    return createApiErrorResponse('ARCHIVE_FETCH_FAILED', 'Repository archive transfer failed.', 502);
  }
}
