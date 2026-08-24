import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getGitHubAccessToken } from '../../app/lib/github-session';

vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn(),
}));

describe('GitHub session token decoding', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('uses the secure Auth.js cookie name in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_SECRET', 'test-secret');
    vi.mocked(getToken).mockResolvedValue({ accessToken: 'github-user-token' });
    const request = new NextRequest('https://repodna.example/api/analyze');

    await expect(getGitHubAccessToken(request)).resolves.toBe('github-user-token');
    expect(getToken).toHaveBeenCalledWith({
      req: request,
      secret: 'test-secret',
      secureCookie: true,
    });
  });

  it('uses the development cookie name outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.mocked(getToken).mockResolvedValue({ accessToken: 'local-token' });
    const request = new NextRequest('http://localhost:3000/api/analyze');

    await expect(getGitHubAccessToken(request)).resolves.toBe('local-token');
    expect(getToken).toHaveBeenCalledWith(
      expect.objectContaining({ secureCookie: false })
    );
  });

  it('does not accept a missing or non-string access token', async () => {
    vi.mocked(getToken).mockResolvedValue({ accessToken: 123 });
    const request = new NextRequest('http://localhost:3000/api/analyze');

    await expect(getGitHubAccessToken(request)).resolves.toBeUndefined();
  });
});
