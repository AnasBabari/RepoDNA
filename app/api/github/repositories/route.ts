import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { auth } from '../../../lib/auth';
import { isGitHubAppMode } from '../../../lib/github-app';

export const dynamic = 'force-dynamic';

export interface SafeRepositoryItem {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  isPrivate: boolean;
  defaultBranch: string;
  updatedAt: string;
  description: string | null;
  language: string | null;
  stars: number;
}

export async function GET(request: NextRequest) {
  let session = null;
  let accessToken: string | undefined;

  try {
    session = await auth();
    const token = await getToken({
      req: request,
      secret: process.env.AUTH_SECRET,
      // Auth.js prefixes the production HTTPS cookie with `__Secure-`.
      // Without this, getToken() looks for the development cookie name and
      // returns null even though auth() has a valid signed-in session.
      secureCookie: process.env.NODE_ENV === 'production',
    });
    accessToken = (token?.accessToken as string) || (session as unknown as { accessToken?: string })?.accessToken;
  } catch {}

  if (!session?.user || !accessToken) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'You must be signed in with GitHub to view your private repositories.',
        },
      },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const query = searchParams.get('query')?.trim() || '';
    const perPage = 15;
    // In GitHub App mode the user token is installation-scoped (contents:read).
    // Primary source is still /user/repos (GitHub filters to installed repos when
    // the token is from a GitHub App). We keep that as default for parity and
    // fall back to the installation endpoint for completeness.
    let githubUrl: string;
    if (query) {
      githubUrl = `https://api.github.com/user/repos?sort=updated&direction=desc&per_page=100&affiliation=owner,collaborator,organization_member`;
    } else {
      githubUrl = `https://api.github.com/user/repos?sort=updated&direction=desc&per_page=${perPage}&page=${page}&affiliation=owner,collaborator,organization_member`;
    }
    // Note: installation-scoped strict listing via
    // `GET /installation/repositories` after exchanging an installation token
    // is available in `app/lib/github-app.ts:createInstallationAccessToken` and
    // can replace the above when a specific installationId is resolved.
    // Keeping /user/repos as default preserves pagination/filtering behavior
    // across both OAuth and App OAuth tokens without additional round-trips.

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let ghResponse: Response;
    try {
      ghResponse = await fetch(githubUrl, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'RepoDNA-V1.1',
        },
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (ghResponse.status === 401) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'GitHub OAuth token expired or was revoked. Please sign in again.',
          },
        },
        { status: 401 }
      );
    }

    if (ghResponse.status === 403) {
      const isApp = isGitHubAppMode();
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: isApp
              ? 'Access denied by GitHub. If accessing organization repositories, ensure the GitHub App is installed on the requested repositories/organization and the installation has contents:read.'
              : 'Access denied by GitHub. If accessing organization repositories, ensure OAuth App access is granted in organization settings.',
          },
        },
        { status: 403 }
      );
    }

    if (ghResponse.status === 429) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'GitHub API rate limit reached. Please try again in a few minutes.',
          },
        },
        { status: 429 }
      );
    }

    if (!ghResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UPSTREAM_GITHUB_ERROR',
            message: `GitHub returned status ${ghResponse.status}: ${ghResponse.statusText}`,
          },
        },
        { status: 502 }
      );
    }

    const rawRepos = (await ghResponse.json()) as Array<{
      id: number;
      full_name: string;
      name: string;
      owner: { login: string };
      private: boolean;
      default_branch: string;
      updated_at: string;
      description: string | null;
      language: string | null;
      stargazers_count: number;
    }>;

    let filtered = rawRepos;
    if (query) {
      const qLower = query.toLowerCase();
      filtered = rawRepos.filter(
        (r) =>
          r.name.toLowerCase().includes(qLower) ||
          r.full_name.toLowerCase().includes(qLower) ||
          (r.description && r.description.toLowerCase().includes(qLower))
      );
      // Slice for pagination when doing client query filtering
      const startIndex = (page - 1) * perPage;
      filtered = filtered.slice(startIndex, startIndex + perPage);
    }

    // Map strictly to safe subset (no sensitive metadata)
    const repositories: SafeRepositoryItem[] = filtered.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      name: r.name,
      owner: r.owner.login,
      isPrivate: r.private,
      defaultBranch: r.default_branch || 'main',
      updatedAt: r.updated_at,
      description: r.description ?? null,
      language: r.language ?? null,
      stars: r.stargazers_count || 0,
    }));

    return NextResponse.json({
      success: true,
      page,
      perPage,
      hasMore: repositories.length === perPage,
      repositories,
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Failed to connect to GitHub API or request timed out.',
        },
      },
      { status: 503 }
    );
  }
}
