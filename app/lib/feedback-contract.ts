export const FEEDBACK_USE_CASES = ['onboarding', 'architecture', 'refactoring', 'documentation', 'security', 'other'] as const;
export const FEEDBACK_CAPABILITIES = ['more_languages', 'pr_analysis', 'diagram_export', 'db_erd', 'call_hierarchy', 'custom_rules'] as const;

export interface AggregateFeedback {
  usefulnessScore: number;
  primaryUsecase: string;
  missingCapabilities: string[];
  submissionId: string;
}

/** Reject arbitrary text, unknown fields and identities rather than silently discarding them. */
export function parseAggregateFeedback(value: unknown): AggregateFeedback | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !['usefulnessScore', 'primaryUsecase', 'missingCapabilities', 'submissionId'].includes(key))) return null;
  const { usefulnessScore, primaryUsecase, missingCapabilities, submissionId } = body;
  if (typeof usefulnessScore !== 'number' || !Number.isInteger(usefulnessScore) || usefulnessScore < 1 || usefulnessScore > 5) return null;
  if (typeof primaryUsecase !== 'string' || !FEEDBACK_USE_CASES.some((item) => item === primaryUsecase)) return null;
  if (!Array.isArray(missingCapabilities) || missingCapabilities.length > 6 || missingCapabilities.some((item) => !FEEDBACK_CAPABILITIES.some((allowed) => allowed === item))) return null;
  if (typeof submissionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionId)) return null;
  return { usefulnessScore, primaryUsecase, missingCapabilities: [...new Set(missingCapabilities)], submissionId };
}
