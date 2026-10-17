import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { zipSync, strToU8 } from 'fflate';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), token: vi.fn(), acquire: vi.fn() }));
vi.mock('../../app/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('../../app/lib/github-session', () => ({ getGitHubAccessToken: mocks.token }));
vi.mock('../../app/lib/analyzer/ingestion', async (original) => ({
  ...await original<typeof import('../../app/lib/analyzer/ingestion')>(), fetchGitHubRepo: mocks.acquire,
}));
import { POST as treePost } from '../../app/api/v2/github/private-tree/route';
import { POST as archivePost } from '../../app/api/v2/github/private-archive/route';

const sha = 'd'.repeat(40);
const url = 'https://github.com/owner/private-repo/tree/release%2Fstable';
const request = () => new NextRequest('http://localhost/api/private', { method: 'POST', body: JSON.stringify({ url }), headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'user' } });
  mocks.token.mockResolvedValue('test-private-token');
});
afterEach(() => vi.restoreAllMocks());

it('keeps the explicit private URL and snapshot identity while returning no credentials or public source URL', async () => {
  mocks.acquire.mockResolvedValue({ name: 'private-repo', files: [], skipped: [], source: `https://github.com/owner/private-repo/tree/${sha}`, commitSha: sha, analyzedRef: sha });
  const response = await treePost(request());
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(mocks.acquire.mock.calls[0][0]).toBe(url);
  expect(mocks.acquire.mock.calls[0][2]).toBe('test-private-token');
  expect(data).toMatchObject({ source: 'private:private-repo', commitSha: sha, analyzedRef: sha });
  expect(JSON.stringify(data)).not.toMatch(/test-private-token|github\.com/);
  expect(response.headers.get('Cache-Control')).toContain('no-store, private');
});
it('pins direct private ZIP requests to the selected revision instead of HEAD', async () => {
  const archive = zipSync({ 'repo/main.py': strToU8('print("selected")') });
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const target = String(input);
    if (target.endsWith('/repos/owner/private-repo')) return Response.json({ name: 'private-repo' });
    if (target.endsWith('/commits/release%2Fstable')) return Response.json({ sha });
    if (target.endsWith(`/zipball/${sha}`)) return new Response(archive);
    throw new Error('Unexpected private acquisition request');
  });
  const response = await archivePost(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('X-RepoDNA-Commit')).toBe(sha);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(archive);
  for (const [target, init] of fetchMock.mock.calls) {
    expect(String(target)).not.toContain('HEAD');
    expect(init?.headers).toHaveProperty('Authorization', 'Bearer test-private-token');
  }
});
