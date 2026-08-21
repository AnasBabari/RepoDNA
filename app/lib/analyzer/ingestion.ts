import JSZip from 'jszip';
import { DEFAULT_INGESTION_LIMITS, IngestionError, type DiscoveredFile, type IngestionLimits } from './types';

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

const OWNER_REPO_REGEX = /^[a-zA-Z0-9_.-]+$/;

export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();

  // Full URL: https://github.com/owner/repo or http://github.com/owner/repo
  const urlMatch = trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?\/?$/);
  if (urlMatch) {
    const owner = urlMatch[1];
    const repo = urlMatch[2];
    if (OWNER_REPO_REGEX.test(owner) && OWNER_REPO_REGEX.test(repo)) {
      return { owner, repo };
    }
  }

  // Short format: owner/repo
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    const [owner, repo] = trimmed.split('/');
    if (OWNER_REPO_REGEX.test(owner) && OWNER_REPO_REGEX.test(repo)) {
      return { owner, repo };
    }
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

function validatePath(rawPath: string): void {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new IngestionError('PATH_TRAVERSAL', 'Invalid or empty file path in archive', 400);
  }
  if (rawPath.includes('\0')) {
    throw new IngestionError('PATH_TRAVERSAL', 'Path contains null bytes', 400);
  }
  const normalized = rawPath.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new IngestionError('PATH_TRAVERSAL', `Absolute path detected in archive: ${rawPath}`, 400);
  }
  const segments = normalized.split('/');
  if (segments.some((s) => s === '..')) {
    throw new IngestionError('PATH_TRAVERSAL', `Path traversal attempt (..) detected in archive: ${rawPath}`, 400);
  }
}

async function sha256(content: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const msgBuffer = new TextEncoder().encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Simple fast string hash fallback
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
  repoName = 'repository',
  limits: IngestionLimits = DEFAULT_INGESTION_LIMITS
): Promise<{ files: DiscoveredFile[]; skipped: { path: string; reason: string }[]; name: string }> {
  // 1. Check compressed archive size
  const byteLength = zipBuffer.byteLength;
  if (byteLength > limits.maxArchiveBytes) {
    throw new IngestionError(
      'ARCHIVE_TOO_LARGE',
      `Compressed archive (${(byteLength / (1024 * 1024)).toFixed(1)} MB) exceeds limit of ${(limits.maxArchiveBytes / (1024 * 1024)).toFixed(0)} MB`,
      413
    );
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBuffer);
  } catch (err) {
    throw new IngestionError('INVALID_ARCHIVE', `Failed to decompress ZIP archive: ${err instanceof Error ? err.message : 'Corrupt format'}`, 400);
  }

  const files: DiscoveredFile[] = [];
  const skipped: { path: string; reason: string }[] = [];
  let totalExtractedBytes = 0;

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
    // 2. Validate against path traversal
    validatePath(rawPath);

    if (entry.dir) continue;
    const relPath = prefix && rawPath.startsWith(prefix) ? rawPath.slice(prefix.length) : rawPath;
    if (!relPath || relPath.startsWith('/')) continue;

    if (isIgnored(relPath)) {
      continue;
    }

    if (!isCandidate(relPath)) {
      continue;
    }

    // 3. Check total files limit
    if (files.length >= limits.maxFiles) {
      throw new IngestionError(
        'TOO_MANY_FILES',
        `Repository exceeds limit of ${limits.maxFiles.toLocaleString()} files`,
        413
      );
    }

    try {
      const text = await entry.async('string');

      // 4. Binary check
      if (text.includes('\0')) {
        skipped.push({ path: relPath, reason: 'binary' });
        continue;
      }

      // 5. Individual file limit check
      if (text.length > limits.maxFileBytes) {
        skipped.push({ path: relPath, reason: 'exceeds_file_size_limit' });
        continue;
      }

      // 6. Cumulative extracted size check (ZIP bomb protection)
      totalExtractedBytes += text.length;
      if (totalExtractedBytes > limits.maxTotalExtractedBytes) {
        throw new IngestionError(
          'EXTRACTED_TOO_LARGE',
          `Extracted repository content (${(totalExtractedBytes / (1024 * 1024)).toFixed(1)} MB) exceeds limit of ${(limits.maxTotalExtractedBytes / (1024 * 1024)).toFixed(0)} MB`,
          413
        );
      }

      const hash = await sha256(text);
      files.push({
        path: relPath,
        size: text.length,
        content: text,
        hash,
      });
    } catch (err) {
      if (err instanceof IngestionError) throw err;
      skipped.push({ path: relPath, reason: 'unreadable' });
    }
  }

  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), skipped, name: repoName };
}

export async function fetchGitHubRepo(
  urlOrOwnerRepo: string,
  limits: IngestionLimits = DEFAULT_INGESTION_LIMITS
): Promise<{ files: DiscoveredFile[]; skipped: { path: string; reason: string }[]; name: string; source: string }> {
  const parsed = parseGitHubUrl(urlOrOwnerRepo);
  if (!parsed) {
    throw new IngestionError(
      'INVALID_GITHUB_URL',
      'Invalid GitHub repository URL. Format: https://github.com/owner/repository',
      400
    );
  }

  const { owner, repo } = parsed;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), limits.fetchTimeoutMs);

  let response: Response;
  try {
    // Try codeload zip first
    const codeloadUrl = `https://codeload.github.com/${owner}/${repo}/zip/HEAD`;
    response = await fetch(codeloadUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'RepoDNA-V1/1.0',
      },
    });

    // Fallback to GitHub API zipball if codeload fails
    if (!response.ok && response.status !== 404) {
      const apiZipUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/HEAD`;
      response = await fetch(apiZipUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'RepoDNA-V1/1.0',
          Accept: 'application/vnd.github.v3+json',
        },
      });
    }
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'))) {
      throw new IngestionError(
        'FETCH_TIMEOUT',
        `GitHub repository fetch timed out after ${(limits.fetchTimeoutMs / 1000).toFixed(0)} seconds`,
        504
      );
    }
    throw new IngestionError(
      'UPSTREAM_GITHUB_ERROR',
      `Failed to connect to GitHub: ${err instanceof Error ? err.message : 'Network error'}`,
      502
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 404) {
    throw new IngestionError(
      'REPO_NOT_FOUND',
      `Repository "https://github.com/${owner}/${repo}" was not found or is private`,
      404
    );
  }

  if (!response.ok) {
    if (response.status === 403 || response.status === 429) {
      throw new IngestionError(
        'UPSTREAM_GITHUB_ERROR',
        `GitHub API rate limit exceeded or access denied (${response.status})`,
        502
      );
    }
    throw new IngestionError(
      'UPSTREAM_GITHUB_ERROR',
      `GitHub returned status ${response.status}: ${response.statusText}`,
      502
    );
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > limits.maxArchiveBytes) {
    throw new IngestionError(
      'ARCHIVE_TOO_LARGE',
      `Repository archive (${(parseInt(contentLength, 10) / (1024 * 1024)).toFixed(1)} MB) exceeds maximum allowed size of ${(limits.maxArchiveBytes / (1024 * 1024)).toFixed(0)} MB`,
      413
    );
  }

  const buffer = await response.arrayBuffer();
  const extracted = await extractFromZip(buffer, repo, limits);
  return {
    ...extracted,
    source: `github:${owner}/${repo}`,
  };
}

export async function extractFromFileList(
  fileList: FileList | File[],
  limits: IngestionLimits = DEFAULT_INGESTION_LIMITS
): Promise<{ files: DiscoveredFile[]; skipped: { path: string; reason: string }[]; name: string; source: string }> {
  const files: DiscoveredFile[] = [];
  const skipped: { path: string; reason: string }[] = [];
  let repoName = 'local-repository';
  let totalExtractedBytes = 0;

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    const rawPath = (file as { webkitRelativePath?: string }).webkitRelativePath || file.name;
    validatePath(rawPath);

    const parts = rawPath.replace(/\\/g, '/').split('/');
    if (parts.length > 1 && repoName === 'local-repository') {
      repoName = parts[0];
    }
    const relPath = parts.length > 1 ? parts.slice(1).join('/') : rawPath;

    if (isIgnored(relPath)) continue;
    if (!isCandidate(relPath)) continue;

    if (files.length >= limits.maxFiles) {
      throw new IngestionError(
        'TOO_MANY_FILES',
        `Selected directory exceeds limit of ${limits.maxFiles.toLocaleString()} files`,
        413
      );
    }

    if (file.size > limits.maxFileBytes) {
      skipped.push({ path: relPath, reason: 'exceeds_file_size_limit' });
      continue;
    }

    try {
      const text = await file.text();
      if (text.includes('\0')) {
        skipped.push({ path: relPath, reason: 'binary' });
        continue;
      }

      totalExtractedBytes += text.length;
      if (totalExtractedBytes > limits.maxTotalExtractedBytes) {
        throw new IngestionError(
          'EXTRACTED_TOO_LARGE',
          `Extracted files (${(totalExtractedBytes / (1024 * 1024)).toFixed(1)} MB) exceed limit of ${(limits.maxTotalExtractedBytes / (1024 * 1024)).toFixed(0)} MB`,
          413
        );
      }

      const hash = await sha256(text);
      files.push({
        path: relPath,
        size: file.size,
        content: text,
        hash,
      });
    } catch (err) {
      if (err instanceof IngestionError) throw err;
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
