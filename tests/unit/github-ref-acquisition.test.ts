import { afterEach, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { fetchGitHubRepo } from '../../app/lib/analyzer/ingestion';
import { analyzePublicRepositoryInBrowser, isDeepScanFailure } from '../../app/lib/deep-scan-client';
import { DEFAULT_INGESTION_LIMITS } from '../../app/lib/analyzer/types';
import type { RepoDNAProjectV2 } from '../../app/lib/analyzer/v2/types';

afterEach(() => vi.restoreAllMocks());
const sha = 'b'.repeat(40);
const content = 'def selected_tag():\n    return 42\n';
const archive = zipSync({ 'repo/main.py': strToU8(content) });
function mockAcquisition() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/commits/v2.31.0') || url.endsWith('/commits/HEAD')) return Response.json({ sha });
    if (url === 'https://api.github.com/repos/owner/repo') return Response.json({ name: 'repo', default_branch: 'main', size: 1000 });
    if (url === `https://codeload.github.com/owner/repo/zip/${sha}`) return new Response(archive, { headers: { 'content-length': String(archive.byteLength) } });
    if (url === `https://api.github.com/repos/owner/repo/git/trees/${sha}?recursive=1`) return Response.json({ truncated: false, tree: [{ type: 'blob', path: 'main.py', sha: 'blob', size: content.length }] });
    if (url === `https://raw.githubusercontent.com/owner/repo/${sha}/main.py`) return new Response(content);
    throw new Error(`Unexpected acquisition request: ${url}`);
  });
}

it.each(['archive', 'tree-first', 'oversized-archive'] as const)('keeps the selected tag pinned through %s acquisition', async (mode) => {
  const fetchMock = mockAcquisition();
  const result = await fetchGitHubRepo('https://github.com/owner/repo/tree/v2.31.0', {
    ...DEFAULT_INGESTION_LIMITS,
    ...(mode === 'tree-first' ? { treeFirstSizeKb: 100 } : {}),
    ...(mode === 'oversized-archive' ? { maxArchiveBytes: 1 } : {}),
  });
  expect(result).toMatchObject({ commitSha: sha, analyzedRef: sha, source: `https://github.com/owner/repo/tree/${sha}` });
  expect(result.files).toHaveLength(1);
  expect(result.files[0].content).toBe(content);
  expect(result.inventory?.acquisitionMode).toBe(mode === 'archive' ? 'archive' : 'git-tree');
  for (const [url] of fetchMock.mock.calls) expect(String(url)).not.toMatch(/HEAD|commits\/main|refs\/heads/);
});

it.each(['', '/tree/v2.31.0'])('browser inline acquisition preserves the same pinned snapshot for %s', async (suffix) => {
  const fetchMock = mockAcquisition();
  const messages: string[] = [];
  const outcome = await analyzePublicRepositoryInBrowser({ url: `https://github.com/owner/repo${suffix}`, onProgress: (event) => messages.push(event.message) });
  expect(isDeepScanFailure(outcome)).toBe(false);
  if (isDeepScanFailure(outcome)) throw new Error(outcome.message);
  const project = outcome.project as RepoDNAProjectV2;
  expect(project.repository).toMatchObject({ commitSha: sha, analyzedRef: sha, source: `https://github.com/owner/repo/tree/${sha}` });
  expect(project.nodes.some((node) => node.name === 'selected_tag')).toBe(true);
  expect(messages.some((message) => message.includes(sha) && message.includes('full repository'))).toBe(true);
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/commits/'))).toHaveLength(1);
});
