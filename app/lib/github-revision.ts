import type { ParsedGitHubUrl } from './analyzer/ingestion';
import { IngestionError } from './analyzer/types';

export function revisionCandidates(parsed: ParsedGitHubUrl): string[] {
  const parts = parsed.refSegments;
  if (!parts) return ['HEAD'];
  const count = parts[0].includes('/') ? 1 : parts.length - (parsed.view === 'blob' ? 1 : 0);
  if (count > 8) throw new IngestionError('GITHUB_REF_UNSUPPORTED', 'Too many possible ref boundaries. Use a commit URL or percent-encode slashes inside the ref.', 400);
  const candidates = Array.from({ length: count }, (_, index) => parts.slice(0, index + 1).join('/'));
  const valid = candidates.filter((ref) => ref !== '@' && !/[\x00-\x20\x7f~^:?*\[\\]/.test(ref) && !ref.includes('..') && !ref.includes('@{') &&
    ref.split('/').every((part) => part && !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock')));
  if (!valid.length) throw new IngestionError('GITHUB_REF_UNSUPPORTED', 'Unsupported Git ref. Use a branch, tag or commit URL; percent-encode slashes inside branch names.', 400);
  return valid;
}

export interface GitHubRevision {
  commitSha: string;
  requestedRef: string;
  sourceUrl: string;
}

/** Bound resolution to eight requests and one shared deadline. Never fall back to HEAD. */
export async function resolveGitHubRevision(parsed: ParsedGitHubUrl, options: { accessToken?: string; signal?: AbortSignal } = {}): Promise<GitHubRevision> {
  const candidates = revisionCandidates(parsed);
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000);
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'RepoDNA/2.0' };
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;
  try {
    const resolved = await Promise.all(candidates.map(async (ref) => {
      const response = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${encodeURIComponent(ref)}`, { headers, signal, cache: 'no-store' });
      if (response.status === 404) return null;
      if (response.status === 401) throw new IngestionError('GITHUB_TOKEN_EXPIRED', 'Reconnect GitHub to resolve this repository revision.', 401);
      if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) throw new IngestionError('UPSTREAM_GITHUB_RATE_LIMITED', 'GitHub rate-limited revision resolution. Retry later.', 429);
      if (response.status === 403) throw new IngestionError('GITHUB_FORBIDDEN', 'GitHub denied access to this repository revision.', 403);
      if (!response.ok) throw new IngestionError('UPSTREAM_GITHUB_ERROR', 'GitHub could not resolve the requested revision.', 502);
      const data = await response.json() as { sha?: unknown };
      if (typeof data.sha !== 'string' || !/^[0-9a-f]{40}$/i.test(data.sha)) throw new IngestionError('UPSTREAM_GITHUB_ERROR', 'GitHub did not return a full commit SHA.', 502);
      return { requestedRef: ref, commitSha: data.sha.toLowerCase() };
    }));
    const matches = resolved.filter((item): item is NonNullable<typeof item> => item !== null);
    if (!matches.length) throw new IngestionError('GITHUB_REF_NOT_FOUND', 'Requested revision was not found or is inaccessible. Check the ref or use a commit URL; HEAD was not analyzed.', 404);
    if (matches.length !== 1) throw new IngestionError('GITHUB_REF_AMBIGUOUS', 'This URL matches multiple ref boundaries. Percent-encode slashes inside the intended ref, or use a full commit URL. HEAD was not analyzed.', 400);
    return { ...matches[0], sourceUrl: `https://github.com/${parsed.owner}/${parsed.repo}/tree/${matches[0].commitSha}` };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof IngestionError) throw error;
    throw new IngestionError(signal.aborted ? 'FETCH_TIMEOUT' : 'UPSTREAM_GITHUB_ERROR', 'GitHub revision resolution failed. No default-branch analysis was substituted.', signal.aborted ? 504 : 502);
  }
}

export function pinGitHubDiscovery<T extends { source: string }>(discovery: T, owner: string, repo: string, commitSha?: string): T & { commitSha?: string; analyzedRef?: string } {
  return commitSha ? { ...discovery, source: `https://github.com/${owner}/${repo}/tree/${commitSha}`, commitSha, analyzedRef: commitSha } : discovery;
}
