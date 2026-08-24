import { getGitHubAuthMode } from './github-app';

interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface GitHubTokenRevocationResult {
  ok: boolean;
  status: number;
  alreadyRevoked: boolean;
}

export function getGitHubOAuthClientCredentials(): OAuthClientCredentials | null {
  const appMode = getGitHubAuthMode() === 'github-app';
  const clientId = (
    appMode
      ? process.env.GITHUB_APP_CLIENT_ID || process.env.AUTH_GITHUB_ID
      : process.env.AUTH_GITHUB_ID
  )?.trim();
  const clientSecret = (
    appMode
      ? process.env.GITHUB_APP_CLIENT_SECRET || process.env.AUTH_GITHUB_SECRET
      : process.env.AUTH_GITHUB_SECRET
  )?.trim();

  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Revoke the current GitHub user access token. GitHub returns 204 when the
 * token is deleted and 404 when it is already absent; both leave RepoDNA
 * without a usable user token and are therefore idempotent success states.
 */
export async function revokeGitHubAccessToken(
  accessToken: string,
  options?: { signal?: AbortSignal }
): Promise<GitHubTokenRevocationResult> {
  const credentials = getGitHubOAuthClientCredentials();
  if (!credentials || !accessToken) {
    return { ok: false, status: 0, alreadyRevoked: false };
  }

  const basicAuthorization = Buffer.from(
    `${credentials.clientId}:${credentials.clientSecret}`,
    'utf-8'
  ).toString('base64');

  const response = await fetch(
    `https://api.github.com/applications/${encodeURIComponent(credentials.clientId)}/token`,
    {
      method: 'DELETE',
      signal: options?.signal,
      headers: {
        Authorization: `Basic ${basicAuthorization}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'RepoDNA-V1.1',
      },
      body: JSON.stringify({ access_token: accessToken }),
    }
  );

  const alreadyRevoked = response.status === 404;
  return {
    ok: response.status === 204 || alreadyRevoked,
    status: response.status,
    alreadyRevoked,
  };
}
