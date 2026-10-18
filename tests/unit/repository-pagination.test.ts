import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('../../app/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'user' } })) }));
vi.mock('../../app/lib/github-session', () => ({ getGitHubAccessToken: vi.fn(async () => 'test-user-token') }));
import { GET } from '../../app/api/github/repositories/route';
const repo = (id: number) => ({ id, name: `repo-${id}`, full_name: `owner/repo-${id}`, owner: { login: 'owner' }, private: true, updated_at: '2026-10-18T00:00:00Z', default_branch: 'main' });
const request = (query: string) => new NextRequest(`http://localhost/api/github/repositories?${query}`);
beforeEach(() => vi.stubEnv('GITHUB_AUTH_MODE', 'oauth'));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('browses 31 OAuth repositories as 15, 15, 1 without double slicing', async () => {
  const all = Array.from({ length: 31 }, (_, index) => repo(index + 1));
  const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get('page'));
    return Response.json(all.slice((page - 1) * 15, page * 15), { headers: page < 3 ? { link: `<https://api.github.com/user/repos?page=${page + 1}>; rel="next"` } : {} });
  });
  const ids: number[] = [];
  for (let page = 1; page <= 3; page++) {
    const response = await GET(request(`page=${page}`));
    const data = await response.json();
    expect(data.repositories).toHaveLength(page < 3 ? 15 : 1);
    expect(data.hasMore).toBe(page < 3);
    ids.push(...data.repositories.map((item: { id: number }) => item.id));
  }
  expect(new Set(ids).size).toBe(31);
  expect(mock).toHaveBeenCalledTimes(3);
});

it('discloses that OAuth search cannot see repositories older than the first 100', async () => {
  const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(Array.from({ length: 100 }, (_, index) => repo(index)), { headers: { link: '<https://api.github.com/user/repos?page=2>; rel="next"' } }));
  const data = await (await GET(request('query=repo-99&page=1'))).json();
  expect(data.repositories).toHaveLength(1);
  expect(data.searchScope).toContain('100 most recently updated');
  expect(data.searchScope).toContain('Older repositories may be omitted');
  expect(data.listingTruncated).toBe(true);
  expect(data.hasMore).toBe(false); // no endless Next button for unknown matches
  expect(String(mock.mock.calls[0][0])).toContain('per_page=100');
});

it('paginates only the App-scoped repository set', async () => {
  vi.stubEnv('GITHUB_AUTH_MODE', 'github-app');
  const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => String(input).includes('/user/installations?')
    ? Response.json({ total_count: 1, installations: [{ id: 17 }] })
    : Response.json({ total_count: 31, repositories: Array.from({ length: 31 }, (_, index) => repo(index)) }));
  for (let page = 1; page <= 3; page++) {
    const data = await (await GET(request(`page=${page}`))).json();
    expect(data.repositories).toHaveLength(page < 3 ? 15 : 1);
    expect(data.hasMore).toBe(page < 3);
    expect(data.searchScope).toBeNull();
  }
  expect(mock.mock.calls.some(([input]) => String(input).includes('/user/repos'))).toBe(false);
});
