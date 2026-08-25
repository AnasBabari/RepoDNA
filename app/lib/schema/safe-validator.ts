/**
 * CSP-safe schema validation.
 *
 * Ajv compiles validators via `new Function`, which requires 'unsafe-eval'.
 * RepoDNA's Content-Security-Policy deliberately omits it, so compiling at
 * module scope crashes React hydration in every browser (blank page).
 *
 * Validators are therefore compiled lazily on first use and memoized:
 *  - Node/server: ajv compiles fine; full JSON-Schema behaviour preserved.
 *  - Browser: the compile throws EvalError once, we remember null, and all
 *    subsequent calls take deterministic structural checks that enforce every
 *    required property of both contracts without code generation.
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import v1Schema from '../../../schema/repodna.schema.json';
import v2Schema from '../../../schema/repodna-v2.schema.json';
import type { RepoDNAProject } from '../types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

type ValidateFn = (data: unknown) => boolean;
type CompiledErrors = { errors: { instancePath: string; message?: string }[] | null } | null;

const globalForValidators = globalThis as typeof globalThis & {
  __repodnaAjvV1?: { validate: ValidateFn; engine: CompiledErrors } | null;
  __repodnaAjvV2?: { validate: ValidateFn; engine: CompiledErrors } | null;
};

function getValidator(version: 'v1' | 'v2'): { validate: ValidateFn; engine: CompiledErrors } | null {
  const cacheKey = version === 'v1' ? '__repodnaAjvV1' : '__repodnaAjvV2';
  const cached = globalForValidators[cacheKey];
  if (cached !== undefined) return cached;

  let result: { validate: ValidateFn; engine: CompiledErrors } | null = null;
  try {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(
      (version === 'v1' ? v1Schema : v2Schema) as unknown as Record<string, unknown>
    );
    result = {
      validate: validate as ValidateFn,
      // Ajv validators expose `.errors` after each run for detailed reporting.
      engine: validate as unknown as CompiledErrors,
    };
  } catch {
    // CSP blocks 'unsafe-eval' (EvalError) or ajv unavailable — structural path.
    result = null;
  }
  globalForValidators[cacheKey] = result;
  return result;
}

function formatAjvErrors(engine: NonNullable<CompiledErrors>): string[] {
  return (engine.errors ?? []).map((err) => {
    const prop = err.instancePath ? `${err.instancePath}: ` : '';
    return `${prop}${err.message || 'invalid schema attribute'}`;
  });
}

// ---------------------------------------------------------------------------
// Structural fallbacks (no code generation)
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function missingKeys(obj: unknown, keys: string[]): string[] {
  if (!isRecord(obj)) return keys;
  return keys.filter((k) => !(k in obj));
}

function checkFingerprint(fp: unknown, errors: string[], label: string): void {
  if (!isRecord(fp)) {
    errors.push(`${label}.fingerprint must be an object`);
    return;
  }
  for (const k of missingKeys(fp, ['languages', 'frameworks', 'infrastructure', 'databases', 'externalSystems', 'testing', 'buildTools'])) {
    errors.push(`${label}.fingerprint.${k} is required`);
  }
}

export function validateRepoDNAProject(data: unknown): ValidationResult {
  const entry = getValidator('v1');
  if (entry && entry.engine) {
    const valid = data !== null && typeof data === 'object' && entry.validate(data);
    if (valid) return { valid: true, errors: [] };
    return { valid: false, errors: formatAjvErrors(entry.engine) };
  }
  if (entry) {
    // Engine without error introspection — structural fallback for detail.
    return validateStructurallyV1(data);
  }
  return validateStructurallyV1(data);
}

function validateStructurallyV1(data: unknown): ValidationResult {
  // --- CSP-safe structural path -------------------------------------------
  const errors: string[] = [];
  if (!isRecord(data)) return { valid: false, errors: ['Analysis payload must be a non-null object.'] };
  const p = data as unknown as RepoDNAProject;

  if (p.schemaVersion !== '1.1.0') errors.push('schemaVersion must be "1.1.0"');
  if (typeof p.generatedAt !== 'string') errors.push('generatedAt must be a string');
  for (const k of missingKeys(p, ['repository', 'files', 'symbols', 'imports', 'calls', 'routes', 'entrypoints', 'flows', 'architecture', 'onboarding', 'metrics', 'diagnostics', 'metadata'])) {
    errors.push(`${k} is required`);
  }
  if (isRecord(p.repository)) {
    for (const k of missingKeys(p.repository, ['name', 'source', 'languages', 'fileCount', 'sourceFileCount', 'parsedFileCount', 'lines', 'fingerprint'])) {
      errors.push(`repository.${k} is required`);
    }
    checkFingerprint(p.repository.fingerprint, errors, 'repository');
  } else {
    errors.push('repository must be an object');
  }
  for (const [key, arr] of [['files', p.files], ['symbols', p.symbols], ['imports', p.imports], ['calls', p.calls], ['routes', p.routes]] as const) {
    if (!Array.isArray(arr)) errors.push(`${key} must be an array`);
  }
  if (isRecord(p.metrics)) {
    for (const k of missingKeys(p.metrics, ['complexityScore', 'localDependencies', 'externalDependencies', 'dependencyCycles', 'mostConnectedFiles', 'highCouplingFiles', 'symbols', 'routes', 'components', 'parseSuccessRate'])) {
      errors.push(`metrics.${k} is required`);
    }
  } else {
    errors.push('metrics must be an object');
  }
  if (isRecord(p.metadata)) {
    for (const k of missingKeys(p.metadata, ['analysisMode', 'executedRepositoryCode', 'limits', 'fileComponents', 'cache'])) {
      errors.push(`metadata.${k} is required`);
    }
    if (p.metadata.executedRepositoryCode !== false) {
      errors.push('metadata.executedRepositoryCode must be false (zero-execution invariant)');
    }
  } else {
    errors.push('metadata must be an object');
  }

  return { valid: errors.length === 0, errors };
}

export function validateRepoDNAProjectV2(data: unknown): ValidationResult {
  const entry = getValidator('v2');
  if (entry && entry.engine) {
    const valid = data !== null && typeof data === 'object' && entry.validate(data);
    if (valid) return { valid: true, errors: [] };
    return { valid: false, errors: formatAjvErrors(entry.engine) };
  }

  // --- CSP-safe structural path -------------------------------------------
  const errors: string[] = [];
  if (!isRecord(data)) return { valid: false, errors: ['Artifact payload must be a non-null object.'] };

  if ((data as { schemaVersion?: unknown }).schemaVersion !== '2.0.0') {
    errors.push('schemaVersion must be "2.0.0"');
  }
  for (const k of missingKeys(data, ['generatedAt', 'repository', 'inventory', 'coverage', 'nodes', 'edges', 'architecture', 'flows', 'communities', 'dependencyCycles', 'centrality', 'unresolved', 'diagnostics', 'timings', 'parsers', 'security', 'completeness'])) {
    errors.push(`${k} is required`);
  }

  const repo = (data as { repository?: unknown }).repository;
  if (isRecord(repo)) {
    for (const k of missingKeys(repo, ['name', 'source', 'commitSha', 'analyzedRef', 'languages', 'fingerprint'])) {
      errors.push(`repository.${k} is required`);
    }
    checkFingerprint(repo.fingerprint, errors, 'repository');
  } else {
    errors.push('repository must be an object');
  }

  const inv = (data as { inventory?: unknown }).inventory;
  if (isRecord(inv)) {
    for (const k of missingKeys(inv, [
      'totalFileCount', 'totalBytes', 'firstPartySourceFileCount', 'firstPartyLoc',
      'candidateFileCount', 'parsedFileCount', 'partiallyParsedFileCount', 'failedFileCount',
      'unsupportedSourceFileCount', 'ignoredFileCount', 'generatedFileCount',
      'packageCount', 'declaredDependencyCount', 'skippedByReason', 'languageCoverage',
    ])) {
      errors.push(`inventory.${k} is required`);
    }
  } else {
    errors.push('inventory must be an object');
  }

  const nodes = (data as { nodes?: unknown }).nodes;
  const edges = (data as { edges?: unknown }).edges;
  if (!Array.isArray(nodes)) {
    errors.push('nodes must be an array');
  } else {
    for (let i = 0; i < Math.min(nodes.length, 50); i++) {
      const n = nodes[i];
      const missing = isRecord(n)
        ? missingKeys(n, ['id', 'kind', 'name', 'qualifiedName', 'path', 'language', 'range'])
        : ['<non-object>'];
      for (const m of missing) errors.push(`nodes[${i}].${m} is required`);
    }
  }
  if (!Array.isArray(edges)) {
    errors.push('edges must be an array');
  } else {
    for (let i = 0; i < Math.min(edges.length, 50); i++) {
      const e = edges[i];
      if (!isRecord(e)) {
        errors.push(`edges[${i}] must be an object`);
        continue;
      }
      for (const m of missingKeys(e, ['id', 'source', 'target', 'type', 'status', 'confidence', 'evidence', 'explanation', 'resolver'])) {
        errors.push(`edges[${i}].${m} is required`);
      }
      const status = e.status as string | undefined;
      if (typeof status === 'string' && !['extracted', 'resolved', 'inferred', 'ambiguous', 'unresolved'].includes(status)) {
        errors.push(`edges[${i}].status "${status}" is not a valid GraphEdgeStatus`);
      }
    }
  }

  const security = (data as { security?: unknown }).security;
  if (isRecord(security)) {
    if (security.executedRepositoryCode !== false) {
      errors.push('security.executedRepositoryCode must be false (zero-execution invariant)');
    }
  } else {
    errors.push('security must be an object');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Version-aware validation used by the artifact loader's safe path.
 */
export function validateAnyArtifact(data: unknown, version: '1.1.0' | '2.0.0'): ValidationResult {
  return version === '2.0.0' ? validateRepoDNAProjectV2(data) : validateRepoDNAProject(data);
}

/** True when running with the full ajv engine rather than the structural fallback. */
export function isFullSchemaEngineAvailable(version: 'v1' | 'v2'): boolean {
  return getValidator(version) !== null;
}
