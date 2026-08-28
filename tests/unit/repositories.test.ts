import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { auth } from '../../app/lib/auth';
import { GET } from '../../app/api/github/repositories/route';
import { getGitHubAccessToken } from '../../app/lib/github-session';

vi.mock('../../app/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('../../app/lib/github-session', () => ({ getGitHubAccessToken: vi.fn() }));

const mockedAuth = vi.mocked(auth);
const mockedGetGitHubAccessToken = vi.mocked(getGitHubAccessToken);

const repository = (overrides: Record<string, unknown> = {}) => ({
  id: 101,
  full_name: 'acme/keep-me',
  name: 'keep-me',
  owner: { login: 'acme' },
  private: true,
  default_branch: 'main',
  updated_at: '2026-08-27T12:00:00Z',
  description: 'A repository worth keeping',
  language: 'TypeScript',
  stargazers_count: 7,
  ...overrides,
});

beforeEach(() => {
  mockedAuth.mockResolvedValue({ user: { id: 'user-1' } } as never);
  mockedGetGitHubAccessToken.mockResolvedValue('ghu_test-token');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('GET /api/github/repositories', () => {
  it('returns 401 Unauthorized when request has no active session or OAuth token', async () => {
    mockedAuth.mockResolvedValue(null as never);
    mockedGetGitHubAccessToken.mockResolvedValue(undefined);
    const req = new NextRequest('http://localhost:3000/api/github/repositories');
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe('no-store, private, max-age=0');
    expect(data.success).toBe(false);
    expect(data.error.code).toBe('UNAUTHORIZED');
  });

  it('lists only explicitly installed repositories in GitHub App mode', async () => {
    vi.stubEnv('GITHUB_AUTH_MODE', 'github-app');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/user/installations?')) {
        return new Response(
          JSON.stringify({
            total_count: 1,
            installations: [{ id: 17, account: { login: 'acme', type: 'Organization' }, repository_selection: 'selected' }],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/user/installations/17/repositories?')) {
        return new Response(
          JSON.stringify({
            total_count: 2,
            repositories: [
              repository(),
              repository({ id: 202, full_name: 'acme/do-not-hide', name: 'do-not-hide', description: 'Another project' }),
            ],
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected GitHub URL: ${url}`);
    });

    const req = new NextRequest('http://localhost:3000/api/github/repositories?query=keep');
    const res = await GET(req);
    const data = await res.json();
    const requestedUrls = fetchMock.mock.calls.map(([input]) => String(input));

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store, private, max-age=0');
    expect(data.success).toBe(true);
    expect(data.repositories).toEqual([
      expect.objectContaining({ fullName: 'acme/keep-me', isPrivate: true }),
    ]);
    expect(requestedUrls.some((url) => url.includes('/user/repos'))).toBe(false);
    expect(requestedUrls).toEqual([
      expect.stringContaining('/user/installations?'),
      expect.stringContaining('/user/installations/17/repositories?'),
    ]);
  });

  it('keeps the OAuth repository endpoint when App mode is disabled', async () => {
    vi.stubEnv('GITHUB_AUTH_MODE', 'oauth');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([repository({ private: false })]), { status: 200 })
    );

    const req = new NextRequest('http://localhost:3000/api/github/repositories');
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store, private, max-age=0');
    expect(data.success).toBe(true);
    expect(data.repositories).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/user/repos');
  });

  it('returns an App-specific forbidden response when installation access is rejected', async () => {
    vi.stubEnv('GITHUB_AUTH_MODE', 'github-app');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 })
    );

    const req = new NextRequest('http://localhost:3000/api/github/repositories');
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error.code).toBe('FORBIDDEN');
    expect(data.error.message).toContain('contents:read');
  });
});
