import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Decode the Auth.js JWT using the cookie name used by the current runtime.
 * Production HTTPS sessions use the `__Secure-` prefix, while local
 * development sessions do not.
 */
export async function getGitHubAccessToken(request: NextRequest): Promise<string | undefined> {
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: process.env.NODE_ENV === 'production',
  });

  return typeof token?.accessToken === 'string' && token.accessToken.length > 0
    ? token.accessToken
    : undefined;
}
