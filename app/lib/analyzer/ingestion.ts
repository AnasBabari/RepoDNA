import * as fflate from 'fflate';
import { DEFAULT_INGESTION_LIMITS, IngestionError, type DiscoveredFile, type IngestionLimits, type IngestionErrorCode } from './types';

export const DEFAULT_IGNORES = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'venv', '.venv', 'env',
  'dist', 'build', 'coverage', '.next', '.vinext', '__pycache__',
  'vendor', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  '.idea', '.vscode', '.repodna', '.turbo', '.cache',
]);

export const SOURCE_EXTENSIONS = new Set([
  '.py', '.pyi', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx',
  '.go', '.json', '.toml', '.yaml', '.yml', '.ini', '.cfg', '.sql',
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

const RESERVED_GITHUB_ROOT_SEGMENTS = new Set([
  'settings', 'explore', 'pricing', 'features', 'pulls', 'issues',
  'notifications', 'marketplace', 'trending', 'collections', 'events',
  'sponsors', 'organizations', 'account', 'login', 'signup', 'logout',
  'about', 'contact', 'security', 'site', 'privacy', 'terms',
]);

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  canonicalUrl: string;
}

export function parseGitHubUrl(url: string): ParsedGitHubUrl | null {
  if (!url || typeof url !== 'string') return null;
  let trimmed = url.trim();

  // Strip wrapping quotes
  trimmed = trimmed.replace(/^["']|["']$/g, '').trim();
  if (!trimmed) return null;

  // Reject credential-bearing URLs (e.g. https://user:pass@github.com)
  if (/@/.test(trimmed) && /^https?:\/\//i.test(trimmed)) {
    return null;
  }

  // Handle SSH formats:
  // 1. git@github.com:owner/repo.git or git@github.com:owner/repo
  // 2. ssh://git@github.com/owner/repo.git or ssh://git@github.com:22/owner/repo.git
  // 3. git+ssh://git@github.com/owner/repo.git
  const scpSshMatch = trimmed.match(/^(?:git\+ssh:\/\/|ssh:\/\/)?git@github\.com(?::(?:\d+\/)?|:|\/)([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?\/?$/i);
  if (scpSshMatch) {
    const owner = scpSshMatch[1];
    const repo = scpSshMatch[2].replace(/\.git$/i, '');
    if (isValidOwnerRepo(owner, repo)) {
      return { owner, repo, canonicalUrl: `https://github.com/${owner}/${repo}` };
    }
  }

  // Strip git+ or git:// or ssh:// prefixes
  trimmed = trimmed.replace(/^(?:git\+|git:\/\/|ssh:\/\/)/i, '');

  // Prepend https:// if starts with github.com or www.github.com
  if (/^(?:www\.)?github\.com\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }

  // Standard WHATWG URL Parsing for http/https
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const hostname = parsed.hostname.toLowerCase();

      // Strict host matching (rejects attacker.github.com.evil.com, github.com.evil.com, etc.)
      if (hostname !== 'github.com' && hostname !== 'www.github.com') {
        return null;
      }

      // Reject non-standard ports or username/password in URL object
      if (parsed.username || parsed.password) {
        return null;
      }

      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length >= 2) {
        const owner = segments[0];
        const repo = segments[1].replace(/\.git$/i, '');

        if (isValidOwnerRepo(owner, repo)) {
          return { owner, repo, canonicalUrl: `https://github.com/${owner}/${repo}` };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  // Short format: owner/repo or @owner/repo (ignoring query/hash if any)
  const shortClean = trimmed.replace(/^@/, '').split(/[?#]/)[0].replace(/\/$/, '');
  const shortParts = shortClean.split('/');
  if (shortParts.length === 2) {
    const owner = shortParts[0];
    const repo = shortParts[1].replace(/\.git$/i, '');
    if (isValidOwnerRepo(owner, repo) && !owner.includes(':') && !owner.includes('.')) {
      return { owner, repo, canonicalUrl: `https://github.com/${owner}/${repo}` };
    }
  }

  return null;
}

function isValidOwnerRepo(owner: string, repo: string): boolean {
  if (!owner || !repo) return false;
  if (!OWNER_REPO_REGEX.test(owner) || !OWNER_REPO_REGEX.test(repo)) return false;
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return false;
  if (RESERVED_GITHUB_ROOT_SEGMENTS.has(owner.toLowerCase())) return false;
  return true;
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

function normalizeArchivePath(rawPath: string): string {
  return rawPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
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

function combineChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function hasValidZipSignature(u8: Uint8Array): boolean {
  if (u8.byteLength < 22) return false;
  // A valid ZIP contains the End of Central Directory signature (PK\x05\x06) in the trailing bytes
  const searchLen = Math.min(u8.byteLength, 65536 + 22);
  const start = u8.byteLength - searchLen;
  for (let i = u8.byteLength - 4; i >= start; i--) {
    if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) {
      return true;
    }
  }
  return false;
}

export async function extractFromZip(
  zipBuffer: ArrayBuffer | Uint8Array,
  repoName = 'repository',
  limits: IngestionLimits = DEFAULT_INGESTION_LIMITS
): Promise<{ files: DiscoveredFile[]; skipped: { path: string; reason: string }[]; name: string }> {
  const u8 = zipBuffer instanceof Uint8Array ? zipBuffer : new Uint8Array(zipBuffer);
  const byteLength = u8.byteLength;

  // 1. Check compressed archive size
  if (byteLength > limits.maxArchiveBytes) {
    throw new IngestionError(
      'ARCHIVE_TOO_LARGE',
      `Compressed archive (${(byteLength / (1024 * 1024)).toFixed(1)} MB) exceeds limit of ${(limits.maxArchiveBytes / (1024 * 1024)).toFixed(0)} MB`,
      413
    );
  }

  // 2. Validate structural ZIP signature
  if (!hasValidZipSignature(u8)) {
    throw new IngestionError(
      'INVALID_ARCHIVE',
      'Corrupt or truncated ZIP archive: missing End of Central Directory record',
      400
    );
  }

  return new Promise((resolve, reject) => {
    const unzipper = new fflate.Unzip();
    unzipper.register(fflate.UnzipInflate);
    unzipper.register(fflate.UnzipPassThrough);

    let isAborted = false;
    let totalExtractedBytes = 0;
    let archiveEntryCount = 0;
    let candidateFileCount = 0;
    let pendingStreams = 0;
    let zipInputComplete = false;

    const files: DiscoveredFile[] = [];
    const skipped: { path: string; reason: string }[] = [];
    const discoveredPaths: string[] = [];
    const activeStreams = new Set<{ terminate?: () => void }>();

    function abortArchive(code: IngestionErrorCode, message: string, status = 413) {
      if (isAborted) return;
      isAborted = true;
      for (const stream of activeStreams) {
        try { stream.terminate?.(); } catch {}
      }
      activeStreams.clear();
      reject(new IngestionError(code, message, status));
    }

    async function checkCompletion() {
      if (isAborted) return;
      if (zipInputComplete && pendingStreams === 0) {
        // Determine zip root prefix (e.g. repo-name-HEAD/)
        let prefix = '';
        const firstSlash = discoveredPaths[0]?.indexOf('/');
        if (firstSlash !== -1 && discoveredPaths[0]) {
          const potentialPrefix = discoveredPaths[0].slice(0, firstSlash + 1);
          if (discoveredPaths.every((p) => p.startsWith(potentialPrefix) || p === potentialPrefix.slice(0, -1))) {
            prefix = potentialPrefix;
          }
        }

        const normalizedFiles: DiscoveredFile[] = [];
        for (const f of files) {
          const relPath = prefix && f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path;
          if (relPath && !relPath.startsWith('/')) {
            normalizedFiles.push({ ...f, path: relPath });
          }
        }

        const normalizedSkipped: { path: string; reason: string }[] = [];
        for (const s of skipped) {
          const relPath = prefix && s.path.startsWith(prefix) ? s.path.slice(prefix.length) : s.path;
          normalizedSkipped.push({ ...s, path: relPath });
        }

        resolve({
          files: normalizedFiles.sort((a, b) => a.path.localeCompare(b.path)),
          skipped: normalizedSkipped,
          name: repoName,
        });
      }
    }

    unzipper.onfile = (file: fflate.UnzipFile) => {
      if (isAborted) return;

      // 2. Enforce total archive entries budget (header bomb defense)
      archiveEntryCount++;
      if (archiveEntryCount > limits.maxArchiveEntries) {
        abortArchive(
          'TOO_MANY_ARCHIVE_ENTRIES',
          `Archive contains ${archiveEntryCount.toLocaleString()} entries, exceeding limit of ${limits.maxArchiveEntries.toLocaleString()}`,
          413
        );
        return;
      }

      const rawPath = file.name;
      if (rawPath.includes('\0')) {
        abortArchive('PATH_TRAVERSAL', 'Archive path contains invalid null byte', 400);
        return;
      }

      try {
        validatePath(rawPath);
      } catch (err) {
        if (err instanceof IngestionError) {
          abortArchive(err.code, err.message, err.status);
          return;
        }
        abortArchive('PATH_TRAVERSAL', `Invalid path: ${rawPath}`, 400);
        return;
      }

      const normalizedPath = normalizeArchivePath(rawPath);
      discoveredPaths.push(normalizedPath);

      // Skip directory entries
      if (rawPath.endsWith('/')) {
        return;
      }

      // Check path depth
      if (normalizedPath.split('/').length > 32) {
        skipped.push({ path: normalizedPath, reason: 'path_too_deep' });
        return;
      }

      if (isIgnored(normalizedPath)) {
        return;
      }

      if (!isCandidate(normalizedPath)) {
        return;
      }

      // 3. Enforce candidate files budget
      candidateFileCount++;
      if (candidateFileCount > limits.maxFiles) {
        abortArchive(
          'TOO_MANY_FILES',
          `Repository exceeds limit of ${limits.maxFiles.toLocaleString()} candidate files`,
          413
        );
        return;
      }

      // Early metadata size check (hint only)
      if (typeof file.originalSize === 'number' && file.originalSize > limits.maxFileBytes) {
        skipped.push({ path: normalizedPath, reason: 'exceeds_file_size_limit' });
        return;
      }

      // 4. Stream and bound candidate file decompression
      pendingStreams++;
      activeStreams.add(file);

      const chunks: Uint8Array[] = [];
      let entryBytes = 0;
      let entrySkippedReason: string | null = null;

      file.ondata = (err, chunk, final) => {
        if (isAborted) return;

        if (err) {
          if (!entrySkippedReason) {
            skipped.push({ path: normalizedPath, reason: 'unreadable' });
          }
          activeStreams.delete(file);
          pendingStreams--;
          checkCompletion();
          return;
        }

        if (chunk && chunk.byteLength > 0) {
          entryBytes += chunk.byteLength;
          // All emitted bytes count toward cumulative work budget (even if file later skipped)
          totalExtractedBytes += chunk.byteLength;

          // 5. Cumulative extracted archive limit check
          if (totalExtractedBytes > limits.maxTotalExtractedBytes) {
            abortArchive(
              'EXTRACTED_TOO_LARGE',
              `Extracted repository content exceeds limit of ${(limits.maxTotalExtractedBytes / (1024 * 1024)).toFixed(0)} MB`,
              413
            );
            return;
          }

          // 6. Quarantine a suspicious high-ratio entry without discarding every
          // safe file in the repository. Absolute entry and cumulative byte caps
          // still bound all emitted data, including quarantined entries.
          const suspiciousCompressionRatio =
            typeof file.size === 'number' &&
            file.size > 0 &&
            entryBytes > 256 * 1024 &&
            entryBytes / file.size > 200;

          if (suspiciousCompressionRatio) {
            if (!entrySkippedReason) {
              entrySkippedReason = 'suspicious_compression_ratio';
              skipped.push({ path: normalizedPath, reason: entrySkippedReason });
            }
            chunks.length = 0;
            try { file.terminate?.(); } catch {}
          // 7. Individual file limit check
          } else if (entryBytes > limits.maxFileBytes) {
            if (!entrySkippedReason) {
              entrySkippedReason = 'exceeds_file_size_limit';
              skipped.push({ path: normalizedPath, reason: 'exceeds_file_size_limit' });
            }
            // Discard retained chunks immediately
            chunks.length = 0;
            try { file.terminate?.(); } catch {}
          } else if (!entrySkippedReason) {
            chunks.push(chunk);
          }
        }

        if (final) {
          activeStreams.delete(file);
          if (!entrySkippedReason && !isAborted) {
            const combined = combineChunks(chunks, entryBytes);
            const text = fflate.strFromU8(combined);

            // Binary check
            if (text.includes('\0')) {
              skipped.push({ path: normalizedPath, reason: 'binary' });
            } else {
              sha256(text).then((hash) => {
                files.push({
                  path: normalizedPath,
                  size: entryBytes,
                  content: text,
                  hash,
                });
                pendingStreams--;
                checkCompletion();
              }).catch(() => {
                skipped.push({ path: normalizedPath, reason: 'unreadable' });
                pendingStreams--;
                checkCompletion();
              });
              return;
            }
          }
          pendingStreams--;
          checkCompletion();
        }
      };

      try {
        file.start();
      } catch {
        if (!isAborted) {
          activeStreams.delete(file);
          skipped.push({ path: normalizedPath, reason: 'unreadable' });
          pendingStreams--;
          checkCompletion();
        }
      }
    };

    // 8. Feed archive buffer in bounded 64 KiB chunks to avoid stack overflow
    try {
      const CHUNK_SIZE = 64 * 1024;
      for (let offset = 0; offset < u8.byteLength; offset += CHUNK_SIZE) {
        if (isAborted) return;
        const end = Math.min(offset + CHUNK_SIZE, u8.byteLength);
        const slice = u8.subarray(offset, end);
        const isLast = end >= u8.byteLength;
        unzipper.push(slice, isLast);
      }
      zipInputComplete = true;
      checkCompletion();
    } catch (err) {
      abortArchive(
        'INVALID_ARCHIVE',
        `Failed to decompress ZIP archive: ${err instanceof Error ? err.message : 'Corrupt format'}`,
        400
      );
    }
  });
}

async function streamBoundedArrayBuffer(
  response: Response,
  maxBytes: number
): Promise<ArrayBuffer> {
  if (!response.body) {
    const buf = await response.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      throw new IngestionError(
        'ARCHIVE_TOO_LARGE',
        `Repository archive (${(buf.byteLength / (1024 * 1024)).toFixed(1)} MB) exceeds limit of ${(maxBytes / (1024 * 1024)).toFixed(0)} MB`,
        413
      );
    }
    return buf;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel('ARCHIVE_TOO_LARGE');
          throw new IngestionError(
            'ARCHIVE_TOO_LARGE',
            `Repository archive exceeds limit of ${(maxBytes / (1024 * 1024)).toFixed(0)} MB`,
            413
          );
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

export async function fetchGitHubRepo(
  urlOrOwnerRepo: string,
  limits: IngestionLimits = DEFAULT_INGESTION_LIMITS,
  accessToken?: string
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

  // Security: In web environment, only use accessToken if explicitly passed from authorized user session.
  // Never fall back to ambient server PATs.
  const authHeaders: Record<string, string> = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};

  // Helpers that never send Authorization unless explicitly required
  const fetchUnauthCodeload = async (): Promise<Response | null> => {
    const codeloadUrl = `https://codeload.github.com/${owner}/${repo}/zip/HEAD`;
    try {
      const res = await fetch(codeloadUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'RepoDNA-V1/1.0' },
      });
      if (res.ok) return res;
      if (res.status === 404) {
        const branchesToTry = ['main', 'master', 'trunk', 'dev', 'develop'];
        for (const branch of branchesToTry) {
          const codeloadBranch = `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${branch}`;
          const resBranch = await fetch(codeloadBranch, {
            signal: controller.signal,
            headers: { 'User-Agent': 'RepoDNA-V1/1.0' },
          });
          if (resBranch.ok) return resBranch;
        }
      }
      return res;
    } catch (e) {
      throw e;
    }
  };

  const fetchUnauthApiZip = async (): Promise<Response | null> => {
    const apiZipUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/HEAD`;
    return fetch(apiZipUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'RepoDNA-V1/1.0',
        Accept: 'application/vnd.github.v3+json',
      },
    });
  };

  const fetchAuthApiZip = async (): Promise<Response | null> => {
    const apiZipUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/HEAD`;
    return fetch(apiZipUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'RepoDNA-V1/1.0',
        Accept: 'application/vnd.github.v3+json',
        ...authHeaders,
      },
    });
  };

  let response: Response | null = null;
  let authApiResponse: Response | null = null;

  try {
    // Public path: always try unauthenticated codeload first, even when a token is present.
    // This ensures an expired private token never breaks public analysis.
    const unauthCodeload = await fetchUnauthCodeload();
    if (unauthCodeload && unauthCodeload.ok) {
      response = unauthCodeload;
    } else if (accessToken) {
      // Unauth codeload failed (likely 404 for private or missing HEAD). Try authenticated API.
      const authRes = await fetchAuthApiZip();
      authApiResponse = authRes;
      if (authRes && authRes.ok) {
        response = authRes;
      } else if (authRes && (authRes.status === 401 || authRes.status === 403)) {
        const rateLimitRemaining = authRes.headers.get('x-ratelimit-remaining');
        const isRateLimited = authRes.status === 429 || (authRes.status === 403 && rateLimitRemaining === '0');
        if (isRateLimited) {
          response = authRes;
        } else {
          // Retry without credentials for public repos; if that succeeds the repo is public
          // and the token was the problem. If it also 404s the repo is private + token is bad.
          const unauthApi = await fetchUnauthApiZip();
          if (unauthApi && unauthApi.ok) {
            response = unauthApi;
          } else if (unauthApi && unauthApi.status === 404) {
            // Confirm true auth failure vs missing repo — surfaced as structured auth error
            response = authRes;
          } else if (unauthApi) {
            response = unauthApi;
          } else {
            response = authRes;
          }
        }
      } else if (authRes) {
        // Non-auth failure (404, 429, 502 etc.) — keep it for error mapping below
        response = authRes;
      }

      // If still no successful response after auth failure, also try unauth API directly
      if ((!response || !response.ok) && accessToken && !response?.ok) {
        // For cases where codeload 404 and authApi 404, also try unauth API directly
        // (covers the scenario where codeload HEAD failed but API without token might succeed for public)
        if (!authApiResponse || authApiResponse.status === 404) {
          const fallbackUnauthApi = await fetchUnauthApiZip();
          if (fallbackUnauthApi && fallbackUnauthApi.ok) {
            response = fallbackUnauthApi;
          } else if (!response) {
            response = fallbackUnauthApi;
          }
        }
      }
    } else {
      // No token: classic public path
      if (unauthCodeload && unauthCodeload.ok) {
        response = unauthCodeload;
      } else if (unauthCodeload && unauthCodeload.status !== 404) {
        // Non-404 failure — try unauth API before giving up
        const unauthApi = await fetchUnauthApiZip();
        response = unauthApi && unauthApi.ok ? unauthApi : unauthCodeload;
        if (!response.ok && unauthApi && !unauthApi.ok && unauthApi.status !== 404) response = unauthApi;
      } else {
        // 404 on codeload — try unauth API
        const unauthApi = await fetchUnauthApiZip();
        response = unauthApi;
      }
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

  if (!response) {
    throw new IngestionError('UPSTREAM_GITHUB_ERROR', 'GitHub returned no response', 502);
  }

  if (response.status === 404) {
    throw new IngestionError(
      'REPO_NOT_FOUND',
      accessToken
        ? `Repository "${owner}/${repo}" was not found or your GitHub account does not have access.`
        : `Repository "https://github.com/${owner}/${repo}" was not found or is private. Sign in to analyze private repositories.`,
      404
    );
  }

  if (!response.ok) {
    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
    if (response.status === 429 || (response.status === 403 && rateLimitRemaining === '0')) {
      throw new IngestionError(
        'UPSTREAM_GITHUB_RATE_LIMITED',
        'GitHub API rate limit reached on server. Client-side browser analysis is available.',
        429
      );
    }
    if (response.status === 401) {
      throw new IngestionError(
        'GITHUB_TOKEN_EXPIRED',
        'GitHub token expired or revoked. Reconnect GitHub to continue. Public repositories remain available without signing in.',
        401
      );
    }
    if (response.status === 403) {
      throw new IngestionError(
        'GITHUB_FORBIDDEN',
        accessToken
          ? 'GitHub access denied (403). If this is an organization repository, ensure the GitHub App is installed on the repository and the installation has contents:read.'
          : 'GitHub access denied (403). If this is an organization repository, check if OAuth App access is approved in your organization settings.',
        403
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
      `Repository archive (${(parseInt(contentLength, 10) / (1024 * 1024)).toFixed(1)} MB) exceeds limit of ${(limits.maxArchiveBytes / (1024 * 1024)).toFixed(0)} MB`,
      413
    );
  }

  const zipBuffer = await streamBoundedArrayBuffer(response, limits.maxArchiveBytes);
  const result = await extractFromZip(zipBuffer, repo, limits);
  return {
    ...result,
    source: `https://github.com/${owner}/${repo}`,
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
