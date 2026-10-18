import { parseGitHubUrl } from './analyzer/ingestion';

const samples: Readonly<Record<string, string>> = {
  'karpathy/nanogpt': '/samples/nanogpt.json',
  'usestrix/strix': '/samples/strix.json',
  'tiangolo/full-stack-fastapi-template': '/samples/full-stack-fastapi-template.json',
  'pytorch/pytorch': '/samples/pytorch.json',
  'fastapi/fastapi': '/samples/fastapi.json',
  'expressjs/express': '/samples/express.json',
  'yusrababari/twitter-sentiment-analysis': '/samples/twitter-sentiment.json',
};

/** Explicit allowlist: sample selectors never become arbitrary fetch paths. */
export function bundledSample(url: string): { url: string; path: string } | null {
  const parsed = parseGitHubUrl(url);
  if (!parsed || parsed.refSegments) return null;
  const path = samples[`${parsed.owner}/${parsed.repo}`.toLowerCase()];
  return path ? { url: parsed.canonicalUrl, path } : null;
}
