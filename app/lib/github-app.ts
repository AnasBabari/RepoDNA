import crypto from 'crypto';

/**
 * GitHub App least-privilege scaffold (ADR 004).
 *
 * This module is intentionally side-effect free and never reads ambient
 * GITHUB_TOKEN/GITHUB_PAT. It only signs a short-lived App JWT (RS256, 10m)
 * from GITHUB_APP_PRIVATE_KEY and exchanges it for per-installation / user
 * tokens. When env is absent, all helpers return null / isGitHubAppMode()
 * is false and callers fall back to the existing OAuth App flow.
 *
 * No caller should ever fall back to an ambient server PAT — see
 * tests/unit/security-invariants.test.ts:8.
 */

export type GitHubAuthMode = 'github-app' | 'oauth';

export function getGitHubAuthMode(): GitHubAuthMode {
  const override = (process.env.GITHUB_AUTH_MODE || '').toLowerCase().trim();
  if (override === 'github-app' || override === 'oauth') return override;
  // Auto-detect: App mode when App credentials are present
  const hasAppCreds = Boolean(
    process.env.GITHUB_APP_ID &&
      process.env.GITHUB_APP_PRIVATE_KEY &&
      (process.env.GITHUB_APP_CLIENT_ID || process.env.AUTH_GITHUB_ID)
  );
  return hasAppCreds ? 'github-app' : 'oauth';
}

export function isGitHubAppMode(): boolean {
  return getGitHubAuthMode() === 'github-app';
}

export function getGitHubAppCredentials(): {
  appId: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
} | null {
  const appId = (process.env.GITHUB_APP_ID || '').trim();
  let privateKey = (process.env.GITHUB_APP_PRIVATE_KEY || '').trim();
  // Allow base64-encoded PEM or \n-escaped PEM from Vercel env
  if (privateKey && !privateKey.includes('BEGIN')) {
    try {
      const decoded = Buffer.from(privateKey, 'base64').toString('utf-8');
      if (decoded.includes('BEGIN')) privateKey = decoded;
    } catch {}
  }
  privateKey = privateKey.replace(/\\n/g, '\n');
  const clientId = (process.env.GITHUB_APP_CLIENT_ID || process.env.AUTH_GITHUB_ID || '').trim();
  const clientSecret = (process.env.GITHUB_APP_CLIENT_SECRET || process.env.AUTH_GITHUB_SECRET || '').trim();
  if (!appId || !privateKey || !clientId || !clientSecret) return null;
  return { appId, privateKey, clientId, clientSecret };
}

/**
 * Create a GitHub App JWT (RS256, 10m max, we use 9m). Used as:
 *   Authorization: Bearer <jwt>
 * against https://api.github.com/app/installations/* etc.
 */
export function createGitHubAppJwt(opts?: { nowMs?: number }): string | null {
  const creds = getGitHubAppCredentials();
  if (!creds) return null;
  const nowSec = Math.floor((opts?.nowMs ?? Date.now()) / 1000);
  // GitHub requires iat within 60s in the past, exp <= 10m in future
  const payload = {
    iat: nowSec - 60,
    exp: nowSec + 9 * 60,
    iss: creds.appId,
  };
  const header = { alg: 'RS256', typ: 'JWT' } as const;
  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64url');
  const signingInput = `${b64url(header)}.${b64url(payload)}`;
  try {
    const signature = Buffer.from(
      crypto.sign('RSA-SHA256', Buffer.from(signingInput), creds.privateKey)
    ).toString('base64url');
    return `${signingInput}.${signature}`;
  } catch {
    return null;
  }
}

/**
 * Exchange an App JWT for an installation access token.
 * Caller must know the installationId (from /user/installations or webhook).
 */
export async function createInstallationAccessToken(
  installationId: number | string,
  opts?: { jwt?: string; signal?: AbortSignal }
): Promise<{ token: string; expiresAt: string } | null> {
  const jwt = opts?.jwt ?? createGitHubAppJwt();
  if (!jwt) return null;
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    signal: opts?.signal,
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'RepoDNA-V1.1',
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { token?: string; expires_at?: string };
  if (!data.token) return null;
  return { token: data.token, expiresAt: data.expires_at ?? '' };
}

/**
 * List installations accessible to the authenticated user (via user-to-server token).
 * When in GitHub App OAuth mode, this is the installation-scoped listing that
 * respects per-repo install selection — unlike /user/repos with broad `repo` scope.
 */
export async function listUserInstallations(userAccessToken: string, signal?: AbortSignal) {
  const res = await fetch('https://api.github.com/user/installations', {
    signal,
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'RepoDNA-V1.1',
    },
  });
  if (!res.ok) return null;
  return (await res.json()) as {
    total_count: number;
    installations: Array<{ id: number; account: { login: string }; repository_selection: string }>;
  };
}

/**
 * Validate that the required App env is present in production when App mode is selected.
 * Call at startup or in auth config to fail-closed rather than silently downgrading.
 */
export function assertGitHubAppEnvIfRequired(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (!isGitHubAppMode()) return;
  const creds = getGitHubAppCredentials();
  if (!creds) {
    throw new Error(
      'GitHub App mode selected but GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET are incomplete.'
    );
  }
}
