import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../lib/auth';
import {
  GitHubAppRequestError,
  isGitHubAppMode,
  listUserInstallationRepositories,
  listUserInstallations,
  type GitHubAppInstallation,
  type GitHubAppRepository,
} from '../../../lib/github-app';
import { getGitHubAccessToken } from '../../../lib/github-session';

export const dynamic = 'force-dynamic';

const REPOSITORIES_PER_RESPONSE = 15;
const GITHUB_PAGE_SIZE = 100;
const MAX_INSTALLATION_PAGES = 10;
const MAX_REPOSITORY_PAGES_PER_INSTALLATION = 50;

function privateJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store, private, max-age=0');
  headers.set('Vary', 'Cookie');
  return NextResponse.json(body, { ...init, headers });
}

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

async function listInstalledRepositories(
  accessToken: string,
  signal: AbortSignal
): Promise<{ repositories: GitHubAppRepository[]; truncated: boolean }> {
  const installations: GitHubAppInstallation[] = [];
  let truncated = false;

  for (let page = 1; page <= MAX_INSTALLATION_PAGES; page += 1) {
    const result = await listUserInstallations(accessToken, {
      page,
      perPage: GITHUB_PAGE_SIZE,
      signal,
    });
    installations.push(...result.installations);
    if (
      result.installations.length < GITHUB_PAGE_SIZE ||
      installations.length >= result.total_count
    ) {
      break;
    }
    if (page === MAX_INSTALLATION_PAGES) truncated = true;
  }

  const repositories: GitHubAppRepository[] = [];
  for (const installation of installations) {
    let installationRepositoryCount = 0;
    for (let page = 1; page <= MAX_REPOSITORY_PAGES_PER_INSTALLATION; page += 1) {
      const result = await listUserInstallationRepositories(accessToken, installation.id, {
        page,
        perPage: GITHUB_PAGE_SIZE,
        signal,
      });
      repositories.push(...result.repositories);
      installationRepositoryCount += result.repositories.length;

      if (
        result.repositories.length < GITHUB_PAGE_SIZE ||
        installationRepositoryCount >= result.total_count
      ) {
        break;
      }
      if (page === MAX_REPOSITORY_PAGES_PER_INSTALLATION) truncated = true;
    }
  }

  const uniqueRepositories = new Map<number, GitHubAppRepository>();
  for (const repository of repositories) uniqueRepositories.set(repository.id, repository);

  return { repositories: [...uniqueRepositories.values()], truncated };
}

export async function GET(request: NextRequest) {
  let session = null;
  let accessToken: string | undefined;

  try {
    session = await auth();
    accessToken = await getGitHubAccessToken(request);
  } catch {}

  if (!session?.user || !accessToken) {
    return privateJson(
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
    const requestedPage = Number(searchParams.get('page') || '1');
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const query = searchParams.get('query')?.trim() || '';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      let rawRepos: GitHubAppRepository[];
      let listingTruncated = false;

      if (isGitHubAppMode()) {
        // A GitHub App user token can enumerate only the installations and
        // repositories the user is allowed to access. Do not use /user/repos
        // here: it is an OAuth-oriented endpoint and obscures install scope.
        const listing = await listInstalledRepositories(accessToken, controller.signal);
        rawRepos = listing.repositories;
        listingTruncated = listing.truncated;
      } else {
        let githubUrl: string;
        if (query) {
          githubUrl = `https://api.github.com/user/repos?sort=updated&direction=desc&per_page=${GITHUB_PAGE_SIZE}&affiliation=owner,collaborator,organization_member`;
        } else {
          githubUrl = `https://api.github.com/user/repos?sort=updated&direction=desc&per_page=${REPOSITORIES_PER_RESPONSE}&page=${page}&affiliation=owner,collaborator,organization_member`;
        }

        const ghResponse = await fetch(githubUrl, {
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'RepoDNA-V1.1',
          },
        });

        if (ghResponse.status === 401) {
          return privateJson(
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
          return privateJson(
            {
              success: false,
              error: {
                code: 'FORBIDDEN',
                message: 'Access denied by GitHub. If accessing organization repositories, ensure OAuth App access is granted in organization settings.',
              },
            },
            { status: 403 }
          );
        }

        if (ghResponse.status === 429) {
          return privateJson(
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
          return privateJson(
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

        rawRepos = (await ghResponse.json()) as GitHubAppRepository[];
      }

      let filtered = rawRepos;
      if (query) {
        const qLower = query.toLowerCase();
        filtered = rawRepos.filter(
          (repository) =>
            repository.name.toLowerCase().includes(qLower) ||
            repository.full_name.toLowerCase().includes(qLower) ||
            (repository.description && repository.description.toLowerCase().includes(qLower))
        );
      }

      filtered.sort((left, right) => {
        const updatedDifference =
          (Date.parse(right.updated_at) || 0) - (Date.parse(left.updated_at) || 0);
        return updatedDifference || left.full_name.localeCompare(right.full_name);
      });

      const startIndex = (page - 1) * REPOSITORIES_PER_RESPONSE;
      const pageRepositories = filtered.slice(startIndex, startIndex + REPOSITORIES_PER_RESPONSE);

      // Map strictly to safe subset (no sensitive metadata)
      const repositories: SafeRepositoryItem[] = pageRepositories.map((repository) => ({
        id: repository.id,
        fullName: repository.full_name,
        name: repository.name,
        owner: repository.owner.login,
        isPrivate: repository.private,
        defaultBranch: repository.default_branch || 'main',
        updatedAt: repository.updated_at,
        description: repository.description ?? null,
        language: repository.language ?? null,
        stars: repository.stargazers_count || 0,
      }));

      return privateJson({
        success: true,
        page,
        perPage: REPOSITORIES_PER_RESPONSE,
        hasMore: listingTruncated || startIndex + repositories.length < filtered.length,
        repositories,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    // GitHub App user tokens use fine-grained installation endpoints. Keep
    // their failure messages distinct so the picker can explain remediation.
    // OAuth errors above retain the existing response contract.
    if (error instanceof GitHubAppRequestError) {
      if (error.status === 401) {
        return privateJson(
          {
            success: false,
            error: {
              code: 'UNAUTHORIZED',
              message: 'GitHub App access expired or was revoked. Please sign in again.',
            },
          },
          { status: 401 }
        );
      }
      if (error.status === 403) {
        return privateJson(
          {
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Access denied by GitHub. Install RepoDNA on the organization or repositories you want to inspect, with contents:read and metadata:read.',
            },
          },
          { status: 403 }
        );
      }
      if (error.status === 429) {
        return privateJson(
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
    }
    return privateJson(
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
