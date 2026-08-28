import NextAuth, { type NextAuthConfig } from 'next-auth';
import GitHub from 'next-auth/providers/github';
import crypto from 'crypto';
import {
  assertGitHubAppEnvIfRequired,
  getGitHubAppCredentials,
  getGitHubAuthMode,
} from './github-app';

export const AUTH_MAX_AGE_SECONDS = 8 * 60 * 60; // 8 hours

export function generatePseudonymousId(githubId: string | number, secret?: string): string {
  const salt = secret || process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === 'production' && !salt) {
    throw new Error('AUTH_SECRET is required in production for secure pseudonymous identity generation.');
  }
  const effectiveSalt = salt || 'repodna-pseudo-salt-dev';
  return crypto
    .createHmac('sha256', effectiveSalt)
    .update(`github:${githubId}`)
    .digest('hex')
    .slice(0, 16);
}

function resolveGitHubProviderConfig() {
  const mode = getGitHubAuthMode();
  if (mode === 'github-app') {
    const creds = getGitHubAppCredentials();
    // GitHub Apps use the same OAuth flow but with fine-grained permissions
    // granted at install time (contents:read, metadata:read). No `repo` scope.
    // Request only identity scopes; repo access comes from the per-repo install.
    return {
      clientId: creds?.clientId || process.env.AUTH_GITHUB_ID || '',
      clientSecret: creds?.clientSecret || process.env.AUTH_GITHUB_SECRET || '',
      scope: 'read:user user:email',
      mode: 'github-app' as const,
    };
  }
  return {
    clientId: process.env.AUTH_GITHUB_ID || '',
    clientSecret: process.env.AUTH_GITHUB_SECRET || '',
    scope: 'read:user user:email repo',
    mode: 'oauth' as const,
  };
}

const githubProviderConfig = resolveGitHubProviderConfig();
assertGitHubAppEnvIfRequired();

export const authConfig: NextAuthConfig = {
  providers: [
    GitHub({
      clientId: githubProviderConfig.clientId,
      clientSecret: githubProviderConfig.clientSecret,
      authorization: {
        params: {
          scope: githubProviderConfig.scope,
        },
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: AUTH_MAX_AGE_SECONDS,
  },
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account && profile) {
        token.accessToken = account.access_token;
        const rawId = (profile as { id?: string | number }).id ?? token.sub ?? 'anonymous';
        token.pseudonymousId = generatePseudonymousId(rawId);
      }
      return token;
    },
    async session({ session, token }) {
      // Expose only non-sensitive pseudonymous identity and display info
      if (session.user) {
        session.user.id = (token.pseudonymousId as string) || 'anonymous';
      }
      return session;
    },
  },
  secret: process.env.AUTH_SECRET,
  trustHost: true,
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
