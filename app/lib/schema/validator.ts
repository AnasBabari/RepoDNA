import type { RepoDNAProject } from '../types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export { validateRepoDNAProject } from './safe-validator';

/**
 * Asserts that the data conforms to RepoDNAProject schema, throwing an Error if invalid.
 * Uses the CSP-safe lazy validator (full Ajv on the server, structural
 * enforcement in eval-blocked browsers).
 */
export function assertRepoDNAProject(data: unknown): asserts data is RepoDNAProject {
  const result = validateRepoDNAProjectImpl(data);
  if (!result.valid) {
    throw new Error(`Schema validation failed: ${result.errors.join('; ')}`);
  }
}

import { validateRepoDNAProject as validateRepoDNAProjectImpl } from './safe-validator';
