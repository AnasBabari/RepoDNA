import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import canonicalSchema from '../../../schema/repodna.schema.json';
import type { RepoDNAProject } from '../types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const ajv = new Ajv({
  allErrors: true,
  strict: false,
});
addFormats(ajv);

const compiledValidate = ajv.compile(canonicalSchema);

/**
 * Validates whether an arbitrary JSON object strictly conforms to the canonical RepoDNA schema via Ajv.
 */
export function validateRepoDNAProject(data: unknown): ValidationResult {
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Analysis payload must be a non-null object.'] };
  }

  const valid = compiledValidate(data);
  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors = (compiledValidate.errors || []).map((err) => {
    const prop = err.instancePath ? `${err.instancePath}: ` : '';
    return `${prop}${err.message || 'invalid schema attribute'}`;
  });

  return {
    valid: false,
    errors,
  };
}

/**
 * Asserts that the data conforms to RepoDNAProject schema, throwing an Error if invalid.
 */
export function assertRepoDNAProject(data: unknown): asserts data is RepoDNAProject {
  const result = validateRepoDNAProject(data);
  if (!result.valid) {
    throw new Error(`Schema validation failed: ${result.errors.join('; ')}`);
  }
}
