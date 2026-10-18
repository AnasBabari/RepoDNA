import type { Page } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';

export const REVISION_SHA = 'e'.repeat(40);
export const REVISION_REPO = 'https://github.com/karpathy/nanoGPT';
export async function installRevisionHarness(page: Page, baseURL: string | undefined, refs: string[]) {
  const calls = { submitted: [] as { path: string; url: string }[], refs: [] as string[], archives: [] as string[] };
  const archive = zipSync({ 'repo/main.py': strToU8('def selected_release():\n    return 42\n') });
  await page.route('**/*', async (route) => {
    const target = route.request().url();
    const path = new URL(target).pathname;
    if (baseURL && target.startsWith(baseURL)) {
      if (['/api/v2/analyses', '/api/analyze'].includes(path)) {
        calls.submitted.push({ path, url: route.request().postDataJSON().url });
        return route.fulfill({ status: 503, json: { error: { code: 'PUBLIC_ARTIFACT_CACHE_NOT_CONFIGURED', message: 'Use browser analysis for this isolated fixture.', fallbackAvailable: true } } });
      }
      if (path === '/api/stats') return route.fulfill({ status: 503, json: { error: { code: 'STATS_UNAVAILABLE' } } });
      return route.continue();
    }
    const headers = { 'Access-Control-Allow-Origin': '*' };
    if (target === 'https://api.github.com/repos/karpathy/nanoGPT') return route.fulfill({ headers, json: { name: 'nanoGPT', default_branch: 'main', size: 1 } });
    if (target.startsWith('https://api.github.com/repos/karpathy/nanoGPT/commits/')) {
      const ref = decodeURIComponent(target.split('/commits/')[1]);
      calls.refs.push(ref);
      return route.fulfill({ status: refs.includes(ref) ? 200 : 404, headers, json: refs.includes(ref) ? { sha: REVISION_SHA } : {} });
    }
    if (target.startsWith('https://codeload.github.com/')) {
      calls.archives.push(target);
      return route.fulfill({ status: target.endsWith(`/zip/${REVISION_SHA}`) ? 200 : 404, headers, body: Buffer.from(archive) });
    }
    return route.abort();
  });
  return calls;
}
