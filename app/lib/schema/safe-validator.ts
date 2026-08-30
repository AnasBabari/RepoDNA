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

  // Do not even attempt Ajv compilation in a browser. Ajv generates
  // validators with `new Function`, which is intentionally unavailable under
  // RepoDNA's CSP. Skipping the attempt avoids a noisy console error on every
  // client-side artifact validation and goes straight to the equivalent
  // structural validator below. Server-side callers still get full Ajv
  // validation and detailed schema errors.
  if (typeof window !== 'undefined') {
    globalForValidators[cacheKey] = null;
    return null;
  }

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

const MAX_STRUCTURAL_ERRORS = 100;
const NODE_KINDS = new Set([
  'repository', 'workspace', 'package', 'directory', 'module', 'file', 'class',
  'interface', 'function', 'method', 'attribute', 'variable', 'route',
  'controller', 'service', 'repository_layer', 'component', 'data_model',
  'table', 'dependency', 'configuration', 'external_system',
]);
const EDGE_TYPES = new Set([
  'CONTAINS', 'DEFINES', 'IMPORTS', 'CALLS', 'INHERITS', 'IMPLEMENTS',
  'READS', 'WRITES', 'EXPOSES_ROUTE', 'HANDLES', 'INVOKES', 'DEPENDS_ON',
  'CONFIGURES',
]);
const EDGE_STATUSES = new Set(['extracted', 'resolved', 'inferred', 'ambiguous', 'unresolved']);

function addError(errors: string[], message: string): void {
  if (errors.length < MAX_STRUCTURAL_ERRORS) errors.push(message);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1;
}

function isConfidence(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function checkStringFields(
  value: Record<string, unknown>,
  fields: string[],
  errors: string[],
  label: string
): void {
  for (const field of fields) {
    if (typeof value[field] !== 'string') addError(errors, `${label}.${field} must be a string`);
  }
}

function checkSourceRange(value: unknown, errors: string[], label: string): void {
  if (!isRecord(value)) {
    addError(errors, `${label} must be an object`);
    return;
  }
  if (!isPositiveInteger(value.startLine)) addError(errors, `${label}.startLine must be an integer >= 1`);
  if (!isNonNegativeInteger(value.startCol)) addError(errors, `${label}.startCol must be an integer >= 0`);
  if (!isPositiveInteger(value.endLine)) addError(errors, `${label}.endLine must be an integer >= 1`);
  if (!isNonNegativeInteger(value.endCol)) addError(errors, `${label}.endCol must be an integer >= 0`);
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
  for (const k of missingKeys(p, ['repository', 'technologies', 'files', 'symbols', 'imports', 'calls', 'routes', 'databases', 'entrypoints', 'flows', 'architecture', 'metrics', 'diagnostics', 'metadata'])) {
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
  for (const [key, arr] of [
    ['technologies', p.technologies], ['files', p.files], ['symbols', p.symbols],
    ['imports', p.imports], ['calls', p.calls], ['routes', p.routes],
    ['databases', p.databases], ['entrypoints', p.entrypoints], ['flows', p.flows],
    ['diagnostics', p.diagnostics],
  ] as const) {
    if (!Array.isArray(arr)) errors.push(`${key} must be an array`);
  }
  if (Array.isArray(p.files)) {
    p.files.forEach((file, index) => {
      if (!isRecord(file)) return addError(errors, `files[${index}] must be an object`);
      checkStringFields(file, ['id', 'path', 'language', 'hash', 'role'], errors, `files[${index}]`);
      if (!isNonNegativeInteger(file.lines)) addError(errors, `files[${index}].lines must be an integer >= 0`);
      if (!isNonNegativeInteger(file.bytes)) addError(errors, `files[${index}].bytes must be an integer >= 0`);
      if (typeof file.parsed !== 'boolean') addError(errors, `files[${index}].parsed must be a boolean`);
      if (file.error !== undefined && file.error !== null && typeof file.error !== 'string') {
        addError(errors, `files[${index}].error must be a string or null`);
      }
    });
  }
  if (Array.isArray(p.symbols)) {
    p.symbols.forEach((symbol, index) => {
      if (!isRecord(symbol)) return addError(errors, `symbols[${index}] must be an object`);
      checkStringFields(symbol, ['id', 'type', 'name', 'file'], errors, `symbols[${index}]`);
      if (!isPositiveInteger(symbol.line)) addError(errors, `symbols[${index}].line must be an integer >= 1`);
      if (typeof symbol.exported !== 'boolean') addError(errors, `symbols[${index}].exported must be a boolean`);
      if (!isStringArray(symbol.evidence)) addError(errors, `symbols[${index}].evidence must be a string array`);
    });
  }
  for (const [key, requiredStrings] of [
    ['imports', ['id', 'source', 'module']],
    ['calls', ['id', 'source', 'callee', 'file']],
    ['routes', ['id', 'method', 'path', 'handler', 'file', 'framework']],
  ] as const) {
    const rows = p[key];
    if (!Array.isArray(rows)) continue;
    rows.forEach((row, index) => {
      if (!isRecord(row)) return addError(errors, `${key}[${index}] must be an object`);
      const record = row as unknown as Record<string, unknown>;
      checkStringFields(record, [...requiredStrings], errors, `${key}[${index}]`);
      if (!isPositiveInteger(record.line)) addError(errors, `${key}[${index}].line must be an integer >= 1`);
      if (key === 'imports') {
        if (!isStringArray(record.names)) addError(errors, `${key}[${index}].names must be a string array`);
        if (typeof record.external !== 'boolean') addError(errors, `${key}[${index}].external must be a boolean`);
      } else if (!isConfidence(record.confidence)) {
        addError(errors, `${key}[${index}].confidence must be between 0 and 1`);
      }
    });
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

function validateV2GraphIntegrity(data: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(data)) return { valid: false, errors: ['Artifact payload must be a non-null object.'] };

  const nodes = data.nodes;
  const nodeIds = new Set<string>();
  if (Array.isArray(nodes)) {
    for (let i = 0; i < nodes.length && errors.length < MAX_STRUCTURAL_ERRORS; i++) {
      const node = nodes[i];
      if (!isRecord(node) || typeof node.id !== 'string') continue;
      if (nodeIds.has(node.id)) addError(errors, `nodes[${i}].id must be unique`);
      nodeIds.add(node.id);
    }
  }

  const edges = data.edges;
  const edgeIds = new Set<string>();
  if (Array.isArray(edges)) {
    for (let i = 0; i < edges.length && errors.length < MAX_STRUCTURAL_ERRORS; i++) {
      const edge = edges[i];
      if (!isRecord(edge)) continue;
      if (typeof edge.id === 'string') {
        if (edgeIds.has(edge.id)) addError(errors, `edges[${i}].id must be unique`);
        edgeIds.add(edge.id);
      }
      if (typeof edge.source === 'string' && !nodeIds.has(edge.source)) {
        addError(errors, `edges[${i}].source must reference an existing node`);
      }
      if (typeof edge.target === 'string' && !nodeIds.has(edge.target)) {
        addError(errors, `edges[${i}].target must reference an existing node`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateRepoDNAProjectV2(data: unknown): ValidationResult {
  const entry = getValidator('v2');
  if (entry && entry.engine) {
    const valid = data !== null && typeof data === 'object' && entry.validate(data);
    if (valid) return validateV2GraphIntegrity(data);
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
  const nodeIds = new Set<string>();
  if (!Array.isArray(nodes)) {
    errors.push('nodes must be an array');
  } else {
    for (let i = 0; i < nodes.length && errors.length < MAX_STRUCTURAL_ERRORS; i++) {
      const n = nodes[i];
      if (!isRecord(n)) {
        addError(errors, `nodes[${i}] must be an object`);
        continue;
      }
      checkStringFields(n, ['id', 'kind', 'name', 'qualifiedName', 'path', 'language'], errors, `nodes[${i}]`);
      if (typeof n.id === 'string') {
        if (nodeIds.has(n.id)) addError(errors, `nodes[${i}].id must be unique`);
        nodeIds.add(n.id);
      }
      if (typeof n.kind === 'string' && !NODE_KINDS.has(n.kind)) addError(errors, `nodes[${i}].kind is invalid`);
      checkSourceRange(n.range, errors, `nodes[${i}].range`);
      if (n.evidence !== undefined && !isStringArray(n.evidence)) addError(errors, `nodes[${i}].evidence must be a string array`);
      if (n.confidence !== undefined && !isConfidence(n.confidence)) addError(errors, `nodes[${i}].confidence must be between 0 and 1`);
      if (n.metadata !== undefined && !isRecord(n.metadata)) addError(errors, `nodes[${i}].metadata must be an object`);
    }
  }
  if (!Array.isArray(edges)) {
    errors.push('edges must be an array');
  } else {
    const edgeIds = new Set<string>();
    for (let i = 0; i < edges.length && errors.length < MAX_STRUCTURAL_ERRORS; i++) {
      const e = edges[i];
      if (!isRecord(e)) {
        addError(errors, `edges[${i}] must be an object`);
        continue;
      }
      for (const m of missingKeys(e, ['id', 'source', 'target', 'type', 'status', 'confidence', 'evidence', 'explanation', 'resolver'])) {
        addError(errors, `edges[${i}].${m} is required`);
      }
      checkStringFields(e, ['id', 'source', 'type', 'status', 'explanation'], errors, `edges[${i}]`);
      if (typeof e.id === 'string') {
        if (edgeIds.has(e.id)) addError(errors, `edges[${i}].id must be unique`);
        edgeIds.add(e.id);
      }
      if (typeof e.source === 'string' && !nodeIds.has(e.source)) {
        addError(errors, `edges[${i}].source must reference an existing node`);
      }
      if (e.target !== null && typeof e.target !== 'string') addError(errors, `edges[${i}].target must be a string or null`);
      if (typeof e.target === 'string' && !nodeIds.has(e.target)) {
        addError(errors, `edges[${i}].target must reference an existing node`);
      }
      if (typeof e.type === 'string' && !EDGE_TYPES.has(e.type)) addError(errors, `edges[${i}].type is invalid`);
      if (typeof e.status === 'string' && !EDGE_STATUSES.has(e.status)) {
        addError(errors, `edges[${i}].status "${e.status}" is not a valid GraphEdgeStatus`);
      }
      if (!isConfidence(e.confidence)) addError(errors, `edges[${i}].confidence must be between 0 and 1`);
      if (!isRecord(e.evidence)) addError(errors, `edges[${i}].evidence must be an object`);
      else {
        if (typeof e.evidence.file !== 'string') addError(errors, `edges[${i}].evidence.file must be a string`);
        checkSourceRange(e.evidence.range, errors, `edges[${i}].evidence.range`);
      }
      if (!isRecord(e.resolver)) addError(errors, `edges[${i}].resolver must be an object`);
      else checkStringFields(e.resolver, ['name', 'version'], errors, `edges[${i}].resolver`);
      if (e.alternativeCandidates !== undefined && !isStringArray(e.alternativeCandidates)) {
        addError(errors, `edges[${i}].alternativeCandidates must be a string array`);
      }
      if (e.unresolvedExpression !== undefined && e.unresolvedExpression !== null && typeof e.unresolvedExpression !== 'string') {
        addError(errors, `edges[${i}].unresolvedExpression must be a string or null`);
      }
      if (e.metadata !== undefined && !isRecord(e.metadata)) addError(errors, `edges[${i}].metadata must be an object`);
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
