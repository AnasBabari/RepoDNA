import JSZip from 'jszip';
import type { DiscoveredFile } from './types';

export const DEFAULT_IGNORES = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'venv', '.venv', 'env',
  'dist', 'build', 'coverage', '.next', '.vinext', '__pycache__',
  'vendor', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  '.idea', '.vscode', '.repodna', '.turbo', '.cache',
]);

export const SOURCE_EXTENSIONS = new Set([
  '.py', '.pyi', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx',
  '.json', '.toml', '.yaml', '.yml', '.ini', '.cfg', '.sql',
  '.prisma', '.md', '.mdx', '.html', '.css', '.scss', '.dockerfile',
  '.sh', '.bash', '.graphql', '.gql',
]);

export const SPECIAL_FILES = new Set([
  'Dockerfile', 'Procfile', 'Makefile', 'Pipfile', 'package.json',
  'requirements.txt', 'pyproject.toml', 'poetry.lock', 'Pipfile.lock',
  'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml',
  'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'tsconfig.json', 'jsconfig.json',
]);

export const GITHUB_RE = /^https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?\/?$/;

export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const trimmed = url.trim();
  const match = GITHUB_RE.exec(trimmed);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }
  // Also support short format: owner/repo
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    const [owner, repo] = trimmed.split('/');
    return { owner, repo };
  }
  return null;
}

function isCandidate(path: string): boolean {
  const filename = path.split('/').pop()!;
  if (SPECIAL_FILES.has(filename)) return true;
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex === -1) return false;
  return SOURCE_EXTENSIONS.has(filename.slice(dotIndex).toLowerCase());
}

function isIgnored(path: string): boolean {
  const parts = path.split('/');
  return parts.some((p) => DEFAULT_IGNORES.has(p));
}

async function sha256(content: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const msgBuffer = new TextEncoder().encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Simple fast string hash fallback if crypto.subtle is unavailable
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

export async function extractFromZip(
  zipBuffer: ArrayBuffer | Uint8Array,
  repoName = 'repository'
): Promise<{ files: DiscoveredFile[]; skipped: { path: string; reason: string }[]; name: string }> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const files: DiscoveredFile[] = [];
  const skipped: { path: string; reason: string }[] = [];

  // Determine zip root prefix (e.g. repo-name-HEAD/)
  const allPaths = Object.keys(zip.files);
  let prefix = '';
  const firstSlash = allPaths[0]?.indexOf('/');
  if (firstSlash !== -1 && allPaths[0]) {
    const potentialPrefix = allPaths[0].slice(0, firstSlash + 1);
    if (allPaths.every((p) => p.startsWith(potentialPrefix) || p === potentialPrefix.slice(0, -1))) {
      prefix = potentialPrefix;
    }
  }

  for (const [rawPath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const relPath = prefix && rawPath.startsWith(prefix) ? rawPath.slice(prefix.length) : rawPath;
    if (!relPath || relPath.startsWith('/') || relPath.includes('..')) continue;

    if (isIgnored(relPath)) {
      continue;
    }

    if (!isCandidate(relPath)) {
      continue;
    }

    try {
      const text = await entry.async('string');
      // Simple binary check
      if (text.includes('\0')) {
        skipped.push({ path: relPath, reason: 'binary' });
        continue;
      }

      const hash = await sha256(text);
      files.push({
        path: relPath,
        size: text.length,
        content: text,
        hash,
      });
    } catch {
      skipped.push({ path: relPath, reason: 'unreadable' });
    }
  }

  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), skipped, name: repoName };
}

export async function fetchGitHubRepo(
  urlOrOwnerRepo: string
): Promise<{ files: DiscoveredFile[]; skipped: { path: string; reason: string }[]; name: string; source: string }> {
  const parsed = parseGitHubUrl(urlOrOwnerRepo);
  if (!parsed) {
    throw new Error('Invalid GitHub repository URL. Format: https://github.com/owner/repository');
  }

  const { owner, repo } = parsed;

  // Try codeload zip first
  const codeloadUrl = `https://codeload.github.com/${owner}/${repo}/zip/HEAD`;
  let response = await fetch(codeloadUrl);

  // Fallback to GitHub API zipball if codeload fails
  if (!response.ok) {
    const apiZipUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/HEAD`;
    response = await fetch(apiZipUrl, {
      headers: {
        'User-Agent': 'RepoDNA-Web/1.0',
        Accept: 'application/vnd.github.v3+json',
      },
    });
  }

  if (!response.ok) {
    throw new Error(`Could not access repository https://github.com/${owner}/${repo}. Status: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const extracted = await extractFromZip(buffer, repo);
  return {
    ...extracted,
    source: `github:${owner}/${repo}`,
  };
}

export async function extractFromFileList(
  fileList: FileList | File[]
): Promise<{ files: DiscoveredFile[]; skipped: { path: string; reason: string }[]; name: string; source: string }> {
  const files: DiscoveredFile[] = [];
  const skipped: { path: string; reason: string }[] = [];
  let repoName = 'local-repository';

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    const path = (file as { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const parts = path.split('/');
    if (parts.length > 1 && repoName === 'local-repository') {
      repoName = parts[0];
    }
    const relPath = parts.length > 1 ? parts.slice(1).join('/') : path;

    if (isIgnored(relPath)) continue;
    if (!isCandidate(relPath)) continue;

    try {
      const text = await file.text();
      if (text.includes('\0')) {
        skipped.push({ path: relPath, reason: 'binary' });
        continue;
      }
      const hash = await sha256(text);
      files.push({
        path: relPath,
        size: file.size,
        content: text,
        hash,
      });
    } catch {
      skipped.push({ path: relPath, reason: 'unreadable' });
    }
  }

  return {
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    skipped,
    name: repoName,
    source: 'upload:files',
  };
}
