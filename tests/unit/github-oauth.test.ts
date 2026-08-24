import { afterEach, describe, expect, it, vi } from 'vitest';
import { revokeGitHubAccessToken } from '../../app/lib/github-oauth';

describe('GitHub access-token revocation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function configureGitHubApp() {
    vi.stubEnv('GITHUB_AUTH_MODE', 'github-app');
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'Iv1.test-client');
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'test-client-secret');
  }

  it('revokes the current token with GitHub App client authentication', async () => {
    configureGitHubApp();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 })
    );

    await expect(revokeGitHubAccessToken('ghu_user-token')).resolves.toEqual({
      ok: true,
      status: 204,
      alreadyRevoked: false,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/applications/Iv1.test-client/token',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('Iv1.test-client:test-client-secret').toString('base64')}`,
        }),
        body: JSON.stringify({ access_token: 'ghu_user-token' }),
      })
    );
  });

  it('treats an already-absent token as idempotently revoked', async () => {
    configureGitHubApp();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));

    await expect(revokeGitHubAccessToken('expired-token')).resolves.toEqual({
      ok: true,
      status: 404,
      alreadyRevoked: true,
    });
  });

  it('fails closed when credentials are unavailable or GitHub rejects revocation', async () => {
    vi.stubEnv('GITHUB_AUTH_MODE', 'github-app');
    await expect(revokeGitHubAccessToken('token')).resolves.toEqual({
      ok: false,
      status: 0,
      alreadyRevoked: false,
    });

    configureGitHubApp();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }));
    await expect(revokeGitHubAccessToken('token')).resolves.toEqual({
      ok: false,
      status: 500,
      alreadyRevoked: false,
    });
  });
});
