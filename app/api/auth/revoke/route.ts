import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../lib/auth';
import { revokeGitHubAccessToken } from '../../../lib/github-oauth';
import { getGitHubAccessToken } from '../../../lib/github-session';

export const dynamic = 'force-dynamic';
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, private, max-age=0', 'X-Content-Type-Options': 'nosniff' };

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const accessToken = await getGitHubAccessToken(request);
    if (!session?.user || !accessToken) {
      return NextResponse.json({ success: false, message: 'Not authenticated' }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    let result;
    try {
      result = await revokeGitHubAccessToken(accessToken, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!result.ok) {
      const status = result.status === 0 ? 500 : 502;
      return NextResponse.json(
        {
          success: false,
          message:
            result.status === 0
              ? 'GitHub revocation is not configured correctly.'
              : 'GitHub did not confirm token revocation. Your local session remains active.',
        },
        { status, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: result.alreadyRevoked
          ? 'GitHub access was already revoked.'
          : 'GitHub access token revoked successfully.',
        githubSettingsUrl: 'https://github.com/settings/installations',
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err: unknown) {
    const timedOut = err instanceof Error && err.name === 'AbortError';
    return NextResponse.json(
      {
        success: false,
        message: timedOut
          ? 'GitHub revocation timed out. Your local session remains active.'
          : 'GitHub revocation failed. Your local session remains active.',
      },
      { status: timedOut ? 504 : 502, headers: NO_STORE_HEADERS }
    );
  }
}
