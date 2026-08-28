import { generateKeyPairSync, verify } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertGitHubAppEnvIfRequired,
  createGitHubAppJwt,
  getGitHubAppCredentials,
  getGitHubAuthMode,
  listUserInstallationRepositories,
  listUserInstallations,
} from '../../app/lib/github-app';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function configureApp(privateKey: string) {
  vi.stubEnv('GITHUB_APP_ID', '12345');
  vi.stubEnv('GITHUB_APP_PRIVATE_KEY', privateKey);
  vi.stubEnv('GITHUB_APP_CLIENT_ID', 'Iv1.test-client');
  vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'test-client-secret');
}

describe('GitHub App helpers', () => {
  it('normalizes escaped PEM credentials and signs a verifiable short-lived JWT', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    configureApp(pem.replace(/\n/g, '\\n'));

    expect(getGitHubAppCredentials()).toEqual({
      appId: '12345',
      privateKey: pem,
      clientId: 'Iv1.test-client',
      clientSecret: 'test-client-secret',
    });

    const nowMs = Date.UTC(2026, 7, 28, 12, 0, 0);
    const token = createGitHubAppJwt({ nowMs });
    expect(token).toBeTruthy();

    const [encodedHeader, encodedPayload, encodedSignature] = token!.split('.');
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as {
      alg: string;
      typ: string;
    };
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      iat: number;
      exp: number;
      iss: string;
    };

    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(payload).toEqual({
      iat: Math.floor(nowMs / 1000) - 60,
      exp: Math.floor(nowMs / 1000) + 9 * 60,
      iss: '12345',
    });
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(`${encodedHeader}.${encodedPayload}`),
        publicKey,
        Buffer.from(encodedSignature, 'base64url')
      )
    ).toBe(true);
  });

  it('accepts a base64 PEM and fails closed for incomplete credentials', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    configureApp(Buffer.from(pem, 'utf8').toString('base64'));
    expect(getGitHubAppCredentials()?.privateKey).toBe(pem);

    vi.stubEnv('GITHUB_APP_PRIVATE_KEY', '');
    expect(getGitHubAppCredentials()).toBeNull();
    expect(createGitHubAppJwt()).toBeNull();
  });

  it('only auto-selects App mode with complete credentials and fails closed when forced incomplete', () => {
    vi.stubEnv('GITHUB_APP_ID', '12345');
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY', 'pem');
    vi.stubEnv('GITHUB_APP_CLIENT_ID', 'Iv1.test-client');
    vi.stubEnv('GITHUB_APP_CLIENT_SECRET', '');

    expect(getGitHubAuthMode()).toBe('oauth');

    vi.stubEnv('GITHUB_AUTH_MODE', 'github-app');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertGitHubAppEnvIfRequired()).toThrow(/GitHub App mode selected/);
  });

  it('requests installations and their repositories with explicit pagination', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      expect((init?.headers as Record<string, string>)['X-GitHub-Api-Version']).toBe('2022-11-28');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer ghu_token');
      return new Response(
        JSON.stringify(
          url.includes('/repositories?')
            ? { total_count: 0, repositories: [] }
            : { total_count: 0, installations: [] }
        ),
        { status: 200 }
      );
    });

    await expect(
      listUserInstallations('ghu_token', { page: 2, perPage: 50 })
    ).resolves.toEqual({ total_count: 0, installations: [] });
    await expect(
      listUserInstallationRepositories('ghu_token', 42, { page: 3, perPage: 25 })
    ).resolves.toEqual({ total_count: 0, repositories: [] });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/user/installations?per_page=50&page=2');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/user/installations/42/repositories?per_page=25&page=3');
  });
});
