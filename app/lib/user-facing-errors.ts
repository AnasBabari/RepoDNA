type ErrorWithDetails = {
  code?: unknown;
  message?: unknown;
};

const FRIENDLY_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  INVALID_REQUEST: 'Enter a GitHub repository URL to start an analysis.',
  INVALID_GITHUB_URL: 'That does not look like a valid GitHub repository URL. Try https://github.com/owner/repository.',
  REPO_NOT_FOUND: 'GitHub could not find that repository. Check the URL, or connect GitHub if it is private.',
  GITHUB_AUTH_REQUIRED: 'Connect GitHub to analyze a private repository.',
  UNAUTHORIZED: 'Your GitHub connection is no longer valid. Reconnect GitHub and try again.',
  GITHUB_TOKEN_EXPIRED: 'Your GitHub connection has expired. Reconnect GitHub and try again.',
  FORBIDDEN: 'GitHub denied access to this repository. Reconnect or install RepoDNA for the repository you want to inspect.',
  GITHUB_FORBIDDEN: 'GitHub denied access to this repository. Reconnect or install RepoDNA for the repository you want to inspect.',
  GITHUB_RATE_LIMITED: 'GitHub is temporarily rate-limiting requests. Try again shortly or use browser analysis.',
  GITHUB_UNAVAILABLE: 'GitHub is temporarily unavailable. Try again shortly or use browser analysis.',
  SERVICE_UNAVAILABLE: 'The repository service is temporarily unavailable. Try again shortly.',
  RATE_LIMITED: 'RepoDNA has reached its analysis limit for now. Wait for the retry window, then try again.',
  UPSTREAM_GITHUB_RATE_LIMITED: 'GitHub is temporarily rate-limiting requests. Try again shortly or use browser analysis.',
  UPSTREAM_GITHUB_ERROR: 'GitHub could not provide this repository right now. Try again shortly or use browser analysis.',
  RATE_LIMIT_UNAVAILABLE: 'Server-side analysis is temporarily unavailable. Try browser analysis instead.',
  FETCH_TIMEOUT: 'GitHub took too long to respond. Try again or use browser analysis.',
  NETWORK_ERROR: 'The repository could not be reached. Check your connection and try again.',
  ARCHIVE_TOO_LARGE: 'This repository is too large for the standard download path. Try again to use the large-repository path, or analyze a focused local folder.',
  EXTRACTED_TOO_LARGE: 'This repository expands beyond the safe analysis limit. Try a smaller repository or a focused local folder.',
  TOO_MANY_FILES: 'This repository contains more files than RepoDNA can analyze safely in one run. Try a smaller or more focused repository.',
  TOO_MANY_ARCHIVE_ENTRIES: 'This repository archive contains too many entries to analyze safely. Try a smaller or more focused repository.',
  SUSPICIOUS_COMPRESSION_RATIO: 'The repository archive could not be accepted safely. Try a different repository or a local folder.',
  INVALID_ARCHIVE: 'This ZIP file is corrupt, ambiguous, or incomplete. Create a fresh archive and try again.',
  PATH_TRAVERSAL: 'This archive contains an unsafe file path and cannot be analyzed.',
  INVALID_DISCOVERY: 'GitHub returned an unreadable repository source. Try again shortly.',
  UNSUPPORTED_LANGUAGE: 'This repository contains source code RepoDNA cannot parse yet.',
  UNREADABLE_FILE: 'RepoDNA could not read one or more repository files.',
  ARCHIVE_FETCH_FAILED: 'GitHub could not provide the repository archive. Try again shortly or use browser analysis.',
  PAYLOAD_TOO_LARGE: 'That request is too large. Try a smaller repository or focused folder.',
  MALFORMED_JSON: 'The request could not be read. Try entering the repository URL again.',
  PUBLIC_ARTIFACT_CACHE_NOT_CONFIGURED: 'Public analysis is temporarily unavailable. Try browser analysis instead.',
  ANALYSIS_CACHE_UNAVAILABLE: 'The saved analysis is temporarily unavailable. Try again shortly.',
  ANALYSIS_ARTIFACT_NOT_FOUND: 'The saved analysis could not be found. Start a new analysis.',
  INVALID_ANALYSIS_ARTIFACT: 'The analysis completed without a usable result. Try the repository again.',
  ANALYSIS_SCHEMA_ERROR: 'RepoDNA received an invalid analysis result. Try again shortly.',
  ANALYSIS_FAILED: 'RepoDNA could not complete this analysis. Try again shortly.',
  WORKFLOW_FAILED: 'The repository analysis stopped before it completed. Try again shortly.',
  WORKFLOW_START_FAILED: 'RepoDNA could not start the repository analysis. Try again shortly.',
  DURABLE_ANALYSIS_UNAVAILABLE: 'The deep analysis service is temporarily unavailable. Try again or use browser analysis.',
  WORKER_UNAVAILABLE: 'Browser analysis could not start. Try again or use the server analysis path.',
  WORKER_ERROR: 'Browser analysis stopped unexpectedly. Try again or use the server analysis path.',
  FALLBACK_FAILED: 'Neither analysis path completed successfully. Try again shortly.',
  INVALID_EXPORT_REQUEST: 'The export request was invalid. Choose an export format and try again.',
  UNSUPPORTED_EXPORT_FORMAT: 'That export format is not supported.',
  PARQUET_EXPORT_DISABLED: 'Parquet export is not enabled yet.',
  EXPORT_GRAPH_INVALID: 'The loaded graph is not valid for export. Start a fresh analysis and try again.',
  EXPORT_TOO_LARGE: 'That export is too large to download safely. Try a smaller repository or focused view.',
  EXPORT_GENERATION_FAILED: 'RepoDNA could not generate that export. Try again shortly.',
  EXPORT_CACHE_UNAVAILABLE: 'Export storage is temporarily unavailable. Try again shortly.',
  EXPORT_CACHE_WRITE_FAILED: 'The export could not be saved securely. Try again shortly.',
  EXPORT_DOWNLOAD_UNAVAILABLE: 'The export download could not be prepared. Try again shortly.',
};

function getErrorCode(error: unknown, explicitCode?: string | null): string | null {
  if (explicitCode) return explicitCode;
  if (!error || typeof error !== 'object') return null;
  const code = (error as ErrorWithDetails).code;
  return typeof code === 'string' && code ? code : null;
}

/**
 * Convert an internal/upstream failure into stable copy suitable for the UI.
 * Detailed codes and request IDs remain available through the diagnostics panel.
 */
export function getUserFacingErrorMessage(
  error: unknown,
  fallback: string,
  explicitCode?: string | null
): string {
  const code = getErrorCode(error, explicitCode);
  return (code && FRIENDLY_ERROR_MESSAGES[code]) || fallback;
}
