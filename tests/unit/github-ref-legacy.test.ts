import { afterEach, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { analyzeGitHubUrl } from '../../app/lib/analyzer';
import { validateRepoDNAProject } from '../../app/lib/schema/safe-validator';

afterEach(() => vi.restoreAllMocks());
const sha = 'f'.repeat(40);
it.each([['', 'HEAD'], ['/tree/release', 'release'], [`/commit/${sha}`, sha]])('pins the legacy server fallback for %s before extracting source', async (suffix, ref) => {
  const archive = zipSync({ 'repo/main.py': strToU8('def selected_release():\n    return 42\n') });
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const target = String(input);
    if (target.endsWith(`/commits/${ref}`)) return Response.json({ sha });
    if (target === 'https://api.github.com/repos/owner/repo') return Response.json({ name: 'repo', default_branch: 'main', size: 1 });
    if (target === `https://codeload.github.com/owner/repo/zip/${sha}`) return new Response(archive);
    throw new Error('Unexpected fallback acquisition request');
  });
  const project = await analyzeGitHubUrl(`https://github.com/owner/repo${suffix}`);
  expect(project.repository).toMatchObject({ commitSha: sha, analyzedRef: sha, source: `https://github.com/owner/repo/tree/${sha}` });
  expect(validateRepoDNAProject(project).valid).toBe(true);
  expect(project.files.some((file) => file.path === 'main.py')).toBe(true);
  expect(fetchMock.mock.calls.filter(([target]) => String(target).includes('/commits/'))).toHaveLength(1);
  expect(fetchMock.mock.calls.some(([target]) => /zip\/(HEAD|main)/.test(String(target)))).toBe(false);
});
