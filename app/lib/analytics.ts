import posthog from 'posthog-js';

export const POSTHOG_EU_HOST = 'https://eu.i.posthog.com';
export const CONSENT_STORAGE_KEY = 'repodna_analytics_consent';

export type ConsentStatus = 'granted' | 'denied' | 'pending';

export type SourceType = 'github_public' | 'github_private' | 'local_folder' | 'zip_upload' | 'demo';

export type DurationBucket = '<5s' | '5-15s' | '15-30s' | '>30s';
export type FileCountBucket = '<50' | '50-200' | '200-1000' | '1000+';

export function bucketDuration(durationMs: number): DurationBucket {
  if (durationMs < 5000) return '<5s';
  if (durationMs < 15000) return '5-15s';
  if (durationMs < 30000) return '15-30s';
  return '>30s';
}

export function bucketFileCount(count: number): FileCountBucket {
  if (count < 50) return '<50';
  if (count <= 200) return '50-200';
  if (count <= 1000) return '200-1000';
  return '1000+';
}

// Disallowed keys that must NEVER be passed to analytics
const DISALLOWED_PROPERTY_KEYS = new Set([
  'url',
  'repo',
  'repository',
  'name',
  'repo_name',
  'path',
  'file_path',
  'filename',
  'symbol',
  'symbol_name',
  'code',
  'content',
  'source',
  'stack',
  'token',
  'access_token',
  'email',
]);

export function sanitizeAnalyticsPayload(properties: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    const keyLower = key.toLowerCase();
    if (DISALLOWED_PROPERTY_KEYS.has(keyLower)) {
      continue; // Block disallowed fields
    }
    // Block string values containing URLs or sensitive characters
    if (typeof value === 'string' && (value.includes('http://') || value.includes('https://') || value.includes('/'))) {
      if (!['<5s', '5-15s', '15-30s', '>30s', '4/5', '5/5', '1/5', '2/5', '3/5'].includes(value)) {
        continue;
      }
    }
    sanitized[key] = value;
  }
  return sanitized;
}

let isInitialized = false;

export function initAnalytics(): void {
  if (typeof window === 'undefined' || isInitialized) return;

  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || POSTHOG_EU_HOST;

  if (!apiKey) {
    // In local dev without key, analytics remains dormant
    return;
  }

  const consent = getConsentStatus();
  if (consent === 'denied') return;

  try {
    posthog.init(apiKey, {
      api_host: host,
      autocapture: false, // Disabled as required
      disable_session_recording: true, // Disabled session replay
      person_profiles: 'identified_only',
      opt_out_capturing_by_default: consent !== 'granted',
      loaded: (ph) => {
        if (consent === 'granted') {
          ph.opt_in_capturing();
        } else {
          ph.opt_out_capturing();
        }
      },
    });
    isInitialized = true;
  } catch (err) {
    console.warn('[Analytics] PostHog init skipped:', err);
  }
}

export function getConsentStatus(): ConsentStatus {
  if (typeof window === 'undefined') return 'pending';
  const val = localStorage.getItem(CONSENT_STORAGE_KEY);
  if (val === 'granted' || val === 'denied') return val;
  return 'pending';
}

export function setConsentStatus(status: 'granted' | 'denied'): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CONSENT_STORAGE_KEY, status);
  if (status === 'granted') {
    initAnalytics();
    try {
      posthog.opt_in_capturing();
    } catch {}
  } else {
    try {
      posthog.opt_out_capturing();
    } catch {}
  }
}

export function identifyUser(pseudonymousId: string): void {
  if (getConsentStatus() !== 'granted') return;
  try {
    posthog.identify(pseudonymousId);
  } catch {}
}

export function resetUser(): void {
  try {
    posthog.reset();
  } catch {}
}

export function captureEvent(eventName: string, properties: Record<string, unknown> = {}): void {
  if (getConsentStatus() !== 'granted') return;
  try {
    const cleanProps = sanitizeAnalyticsPayload(properties);
    posthog.capture(eventName, cleanProps);
  } catch {}
}

// -------------------------------------------------------------
// Type-Safe Allowlist Trackers (No PII / No Source / No Repo Names)
// -------------------------------------------------------------

export function trackAnalysisIntent(sourceType: SourceType): void {
  captureEvent('analysis_intent', { source_type: sourceType });
}

export function trackAnalysisCompleted(
  sourceType: SourceType,
  durationMs: number,
  fileCount: number,
  quotaType: 'public' | 'authenticated' = 'public'
): void {
  captureEvent('analysis_completed', {
    source_type: sourceType,
    duration_bucket: bucketDuration(durationMs),
    file_count_bucket: bucketFileCount(fileCount),
    quota_type: quotaType,
    success: true,
  });
}

export function trackAnalysisFailed(
  sourceType: SourceType,
  errorCode: string,
  failureCategory: string
): void {
  captureEvent('analysis_failed', {
    source_type: sourceType,
    error_code: errorCode,
    failure_category: failureCategory,
  });
}

export function trackAuthFlow(action: 'sign_in_initiated' | 'sign_in_completed' | 'signed_out' | 'scope_revoked'): void {
  captureEvent('auth_flow', { action });
}

export function trackViewChanged(view: string): void {
  captureEvent('workspace_view_changed', { view_name: view });
}

export type ExportFormat = 'json' | 'mermaid' | 'txt' | 'graph_json' | 'graph_csv' | 'cypher' | 'parquet';

export type ExportSizeBucket = '<100KB' | '100KB-1MB' | '1MB-10MB' | '10MB+';

export function bucketExportSize(byteSize: number): ExportSizeBucket {
  if (byteSize < 100 * 1024) return '<100KB';
  if (byteSize < 1024 * 1024) return '100KB-1MB';
  if (byteSize < 10 * 1024 * 1024) return '1MB-10MB';
  return '10MB+';
}

export function trackArtifactExported(format: ExportFormat): void {
  captureEvent('artifact_exported', { format });
}

export function trackGraphExported(input: {
  format: Extract<ExportFormat, 'graph_json' | 'graph_csv' | 'cypher' | 'parquet'>;
  sourceCategory: string;
  cacheLayer: 'vercel_blob' | 'indexeddb' | 'browser_worker';
  cacheHit: boolean;
  success: boolean;
  durationMs: number;
  byteSize: number;
}): void {
  captureEvent('graph_exported', {
    format: input.format,
    source_category: input.sourceCategory,
    cache_layer: input.cacheLayer,
    cache_hit: input.cacheHit,
    success: input.success,
    duration_bucket: bucketDuration(input.durationMs),
    size_bucket: bucketExportSize(input.byteSize),
  });
}

export function trackFallbackUsed(reason: 'rate_limited' | 'network_error' | 'timeout' | 'service_unavailable'): void {
  captureEvent('fallback_used', { reason });
}

export function trackFeedbackSubmitted(feedback: {
  usefulnessScore: number;
  primaryUsecase: string;
  missingCapabilities: string[];
  hasTextFeedback: boolean;
}): void {
  captureEvent('feedback_submitted', {
    usefulness_score: `${feedback.usefulnessScore}/5`,
    primary_usecase: feedback.primaryUsecase,
    missing_capabilities_count: feedback.missingCapabilities.length,
    missing_capabilities: feedback.missingCapabilities.join(','),
    has_text_comment: feedback.hasTextFeedback,
  });
}

export function isFeatureEnabled(flagKey: string, defaultValue = true): boolean {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const isPostHogEnabled = posthog.isFeatureEnabled(flagKey);
    if (typeof isPostHogEnabled === 'boolean') {
      return isPostHogEnabled;
    }
  } catch {}
  return defaultValue;
}
