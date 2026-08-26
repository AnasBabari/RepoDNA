import { compactStableStringify, sha256Hex, utf8Bytes } from './stable-json';
import { graphExportFilename } from './index';
import { GRAPH_EXPORT_MEDIA_TYPES } from './types';
import type { GraphExportDocumentV1, GraphExportFile } from './types';
import { assertExportableDocument } from './validate';

const CYPHER_BATCH_SIZE = 500;

const ALLOWED_LABELS = new Set([
  'repository',
  'workspace',
  'package',
  'directory',
  'module',
  'file',
  'class',
  'interface',
  'function',
  'method',
  'attribute',
  'variable',
  'route',
  'controller',
  'service',
  'repository_layer',
  'component',
  'data_model',
  'table',
  'dependency',
  'configuration',
  'external_system',
]);

const ALLOWED_REL_TYPES = new Set([
  'CONTAINS',
  'DEFINES',
  'IMPORTS',
  'CALLS',
  'INHERITS',
  'IMPLEMENTS',
  'READS',
  'WRITES',
  'EXPOSES_ROUTE',
  'HANDLES',
  'INVOKES',
  'DEPENDS_ON',
  'CONFIGURES',
  'MEMBER_OF',
]);

function assertAllowedLabel(label: string): void {
  if (!ALLOWED_LABELS.has(label)) throw new Error(`Disallowed Cypher label: ${label}`);
}

function assertAllowedRelType(type: string): void {
  if (!ALLOWED_REL_TYPES.has(type)) throw new Error(`Disallowed Cypher relationship type: ${type}`);
}

function escapeCypherString(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    const code = value.charCodeAt(i);
    if (char === '\\') out += '\\\\';
    else if (char === "'") out += "\\'";
    else if (char === '\n') out += '\\n';
    else if (char === '\r') out += '\\r';
    else if (code === 0) out += '\\u0000';
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else if (code === 0x2028) out += '\\u2028';
    else if (code === 0x2029) out += '\\u2029';
    else out += char;
  }
  return `'${out}'`;
}

function cypherValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'string') return escapeCypherString(value);
  return escapeCypherString(compactStableStringify(value));
}

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

export async function buildCypher(document: GraphExportDocumentV1): Promise<GraphExportFile> {
  assertExportableDocument(document);

  const lines: string[] = [];
  const manifest = document.manifest;

  lines.push('// RepoDNA Graph Export — Cypher');
  lines.push(`// Export schema: ${manifest.exportSchemaVersion}  Exporter: ${manifest.exporterVersion}`);
  lines.push(`// Source digest: ${manifest.sourceArtifactSha256}`);
  lines.push(`// Repository: ${manifest.repository.name}  Source: ${manifest.repository.source}`);
  lines.push(`// Commit: ${manifest.repository.commitSha ?? 'null'}  Ref: ${manifest.repository.analyzedRef ?? 'null'}`);
  lines.push(`// Analyzed at: ${manifest.analyzedAt}`);
  lines.push(
    `// Counts: nodes=${manifest.counts.nodes} relationships=${manifest.counts.relationships} groups=${manifest.counts.groups} memberships=${manifest.counts.groupMemberships} unresolved=${manifest.counts.unresolved}`
  );
  lines.push('// Import: cat repodna-cypher.txt | cypher-shell -u neo4j -p <password> --format verbose');
  lines.push('// Requires: Neo4j 5+  No APOC required  Idempotent via MERGE');
  lines.push('');

  lines.push('CREATE CONSTRAINT repo_dna_entity_id IF NOT EXISTS FOR (n:RepoDNAEntity) REQUIRE n.id IS UNIQUE;');
  lines.push('CREATE CONSTRAINT repo_dna_group_id IF NOT EXISTS FOR (n:RepoDNAGroup) REQUIRE n.id IS UNIQUE;');
  lines.push('CREATE CONSTRAINT repo_dna_unresolved_id IF NOT EXISTS FOR (n:RepoDNAUnresolved) REQUIRE n.id IS UNIQUE;');
  lines.push('');

  const nodesByKind = new Map<string, typeof document.nodes>();
  for (const node of document.nodes) {
    assertAllowedLabel(node.kind);
    const bucket = nodesByKind.get(node.kind);
    if (bucket) bucket.push(node);
    else nodesByKind.set(node.kind, [node]);
  }
  const sortedKinds = [...nodesByKind.keys()].sort();
  for (const kind of sortedKinds) {
    const nodes = nodesByKind.get(kind)!.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const batch of chunk(nodes, CYPHER_BATCH_SIZE)) {
      lines.push('UNWIND [');
      for (let i = 0; i < batch.length; i++) {
        const node = batch[i];
        const row = [
          `id: ${cypherValue(node.id)}`,
          `name: ${cypherValue(node.name)}`,
          `qualifiedName: ${cypherValue(node.qualifiedName)}`,
          `path: ${cypherValue(node.path)}`,
          `language: ${cypherValue(node.language)}`,
          `startLine: ${cypherValue(node.range.startLine)}`,
          `startCol: ${cypherValue(node.range.startCol)}`,
          `endLine: ${cypherValue(node.range.endLine)}`,
          `endCol: ${cypherValue(node.range.endCol)}`,
          `confidence: ${cypherValue(node.confidence)}`,
          `evidenceJson: ${cypherValue(compactStableStringify(node.evidence))}`,
          `propertiesJson: ${cypherValue(compactStableStringify(node.properties))}`,
          `communityIdsJson: ${cypherValue(compactStableStringify(node.communityIds))}`,
          `architectureGroupIdsJson: ${cypherValue(compactStableStringify(node.architectureGroupIds))}`,
        ].join(', ');
        lines.push(`  {${row}}${i < batch.length - 1 ? ',' : ''}`);
      }
      lines.push('] AS row');
      lines.push(`MERGE (n:RepoDNAEntity:\`${kind}\` {id: row.id})`);
      lines.push(
        'SET n.name = row.name, n.qualifiedName = row.qualifiedName, n.path = row.path, n.language = row.language, n.startLine = row.startLine, n.startCol = row.startCol, n.endLine = row.endLine, n.endCol = row.endCol, n.confidence = row.confidence, n.evidenceJson = row.evidenceJson, n.propertiesJson = row.propertiesJson, n.communityIdsJson = row.communityIdsJson, n.architectureGroupIdsJson = row.architectureGroupIdsJson;'
      );
      lines.push('');
    }
  }

  if (document.groups.length > 0) {
    for (const batch of chunk(document.groups, CYPHER_BATCH_SIZE)) {
      lines.push('UNWIND [');
      for (let i = 0; i < batch.length; i++) {
        const group = batch[i];
        const row = [
          `id: ${cypherValue(group.id)}`,
          `groupType: ${cypherValue(group.groupType)}`,
          `label: ${cypherValue(group.label)}`,
          `cohesion: ${cypherValue(group.cohesion)}`,
          `architectureType: ${cypherValue(group.architectureType)}`,
          `confidence: ${cypherValue(group.confidence)}`,
          `evidenceJson: ${cypherValue(compactStableStringify(group.evidence))}`,
          `propertiesJson: ${cypherValue(compactStableStringify(group.properties))}`,
        ].join(', ');
        lines.push(`  {${row}}${i < batch.length - 1 ? ',' : ''}`);
      }
      lines.push('] AS row');
      lines.push('MERGE (n:RepoDNAGroup {id: row.id})');
      lines.push(
        'SET n.groupType = row.groupType, n.label = row.label, n.cohesion = row.cohesion, n.architectureType = row.architectureType, n.confidence = row.confidence, n.evidenceJson = row.evidenceJson, n.propertiesJson = row.propertiesJson;'
      );
      lines.push('');
    }
  }

  const unresolvedRelationships = document.relationships.filter((rel) => rel.targetId === null);
  if (unresolvedRelationships.length > 0) {
    const unresolvedById = new Map(document.unresolved.map((entry) => [entry.edgeId, entry]));
    for (const batch of chunk(unresolvedRelationships, CYPHER_BATCH_SIZE)) {
      lines.push('UNWIND [');
      for (let i = 0; i < batch.length; i++) {
        const rel = batch[i];
        const unresolvedEntry = unresolvedById.get(rel.id);
        const row = [
          `id: ${cypherValue(`unresolved:${rel.id}`)}`,
          `edgeId: ${cypherValue(rel.id)}`,
          `sourceId: ${cypherValue(rel.sourceId)}`,
          `relationshipType: ${cypherValue(rel.type)}`,
          `reason: ${cypherValue(unresolvedEntry?.reason ?? `status:${rel.status}`)}`,
          `unresolvedExpression: ${cypherValue(rel.unresolvedExpression)}`,
          `candidateIdsJson: ${cypherValue(compactStableStringify(rel.alternativeCandidateIds))}`,
          `evidenceFile: ${cypherValue(rel.evidenceFile)}`,
          `evidenceStartLine: ${cypherValue(rel.evidenceRange.startLine)}`,
          `evidenceStartCol: ${cypherValue(rel.evidenceRange.startCol)}`,
          `evidenceEndLine: ${cypherValue(rel.evidenceRange.endLine)}`,
          `evidenceEndCol: ${cypherValue(rel.evidenceRange.endCol)}`,
        ].join(', ');
        lines.push(`  {${row}}${i < batch.length - 1 ? ',' : ''}`);
      }
      lines.push('] AS row');
      lines.push('MERGE (n:RepoDNAUnresolved {id: row.id})');
      lines.push(
        'SET n.edgeId = row.edgeId, n.sourceId = row.sourceId, n.relationshipType = row.relationshipType, n.reason = row.reason, n.unresolvedExpression = row.unresolvedExpression, n.candidateIdsJson = row.candidateIdsJson, n.evidenceFile = row.evidenceFile, n.evidenceStartLine = row.evidenceStartLine, n.evidenceStartCol = row.evidenceStartCol, n.evidenceEndLine = row.evidenceEndLine, n.evidenceEndCol = row.evidenceEndCol;'
      );
      lines.push('');
    }
  }

  const resolvedRelationships = document.relationships.filter((rel) => rel.targetId !== null);
  const relByType = new Map<string, typeof resolvedRelationships>();
  for (const rel of resolvedRelationships) {
    assertAllowedRelType(rel.type);
    const bucket = relByType.get(rel.type);
    if (bucket) bucket.push(rel);
    else relByType.set(rel.type, [rel]);
  }
  for (const type of [...relByType.keys()].sort()) {
    const relationships = relByType.get(type)!.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const batch of chunk(relationships, CYPHER_BATCH_SIZE)) {
      lines.push('UNWIND [');
      for (let i = 0; i < batch.length; i++) {
        const rel = batch[i];
        const row = [
          `id: ${cypherValue(rel.id)}`,
          `sourceId: ${cypherValue(rel.sourceId)}`,
          `targetId: ${cypherValue(rel.targetId)}`,
          `status: ${cypherValue(rel.status)}`,
          `confidence: ${cypherValue(rel.confidence)}`,
          `why: ${cypherValue(rel.why)}`,
          `evidenceFile: ${cypherValue(rel.evidenceFile)}`,
          `evidenceStartLine: ${cypherValue(rel.evidenceRange.startLine)}`,
          `evidenceStartCol: ${cypherValue(rel.evidenceRange.startCol)}`,
          `evidenceEndLine: ${cypherValue(rel.evidenceRange.endLine)}`,
          `evidenceEndCol: ${cypherValue(rel.evidenceRange.endCol)}`,
          `resolverName: ${cypherValue(rel.resolverName)}`,
          `resolverVersion: ${cypherValue(rel.resolverVersion)}`,
          `alternativeCandidateIdsJson: ${cypherValue(compactStableStringify(rel.alternativeCandidateIds))}`,
          `unresolvedExpression: ${cypherValue(rel.unresolvedExpression)}`,
          `propertiesJson: ${cypherValue(compactStableStringify(rel.properties))}`,
        ].join(', ');
        lines.push(`  {${row}}${i < batch.length - 1 ? ',' : ''}`);
      }
      lines.push('] AS row');
      lines.push('MATCH (source:RepoDNAEntity {id: row.sourceId})');
      lines.push('MATCH (target:RepoDNAEntity {id: row.targetId})');
      lines.push(`MERGE (source)-[r:\`${type}\` {id: row.id}]->(target)`);
      lines.push(
        'SET r.status = row.status, r.confidence = row.confidence, r.why = row.why, r.evidenceFile = row.evidenceFile, r.evidenceStartLine = row.evidenceStartLine, r.evidenceStartCol = row.evidenceStartCol, r.evidenceEndLine = row.evidenceEndLine, r.evidenceEndCol = row.evidenceEndCol, r.resolverName = row.resolverName, r.resolverVersion = row.resolverVersion, r.alternativeCandidateIdsJson = row.alternativeCandidateIdsJson, r.unresolvedExpression = row.unresolvedExpression, r.propertiesJson = row.propertiesJson, r.syntheticTarget = false;'
      );
      lines.push('');
    }
  }

  if (unresolvedRelationships.length > 0) {
    const syntheticByType = new Map<string, typeof unresolvedRelationships>();
    for (const rel of unresolvedRelationships) {
      assertAllowedRelType(rel.type);
      const bucket = syntheticByType.get(rel.type);
      if (bucket) bucket.push(rel);
      else syntheticByType.set(rel.type, [rel]);
    }
    for (const type of [...syntheticByType.keys()].sort()) {
      const relationships = syntheticByType.get(type)!.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (const batch of chunk(relationships, CYPHER_BATCH_SIZE)) {
        lines.push('UNWIND [');
        for (let i = 0; i < batch.length; i++) {
          const rel = batch[i];
          const row = [
            `id: ${cypherValue(rel.id)}`,
            `sourceId: ${cypherValue(rel.sourceId)}`,
            `unresolvedId: ${cypherValue(`unresolved:${rel.id}`)}`,
            `status: ${cypherValue(rel.status)}`,
            `confidence: ${cypherValue(rel.confidence)}`,
            `why: ${cypherValue(rel.why)}`,
            `evidenceFile: ${cypherValue(rel.evidenceFile)}`,
            `evidenceStartLine: ${cypherValue(rel.evidenceRange.startLine)}`,
            `evidenceStartCol: ${cypherValue(rel.evidenceRange.startCol)}`,
            `evidenceEndLine: ${cypherValue(rel.evidenceRange.endLine)}`,
            `evidenceEndCol: ${cypherValue(rel.evidenceRange.endCol)}`,
            `resolverName: ${cypherValue(rel.resolverName)}`,
            `resolverVersion: ${cypherValue(rel.resolverVersion)}`,
            `alternativeCandidateIdsJson: ${cypherValue(compactStableStringify(rel.alternativeCandidateIds))}`,
            `unresolvedExpression: ${cypherValue(rel.unresolvedExpression)}`,
            `propertiesJson: ${cypherValue(compactStableStringify(rel.properties))}`,
          ].join(', ');
          lines.push(`  {${row}}${i < batch.length - 1 ? ',' : ''}`);
        }
        lines.push('] AS row');
        lines.push('MATCH (source:RepoDNAEntity {id: row.sourceId})');
        lines.push('MATCH (target:RepoDNAUnresolved {id: row.unresolvedId})');
        lines.push(`MERGE (source)-[r:\`${type}\` {id: row.id}]->(target)`);
        lines.push(
          'SET r.status = row.status, r.confidence = row.confidence, r.why = row.why, r.evidenceFile = row.evidenceFile, r.evidenceStartLine = row.evidenceStartLine, r.evidenceStartCol = row.evidenceStartCol, r.evidenceEndLine = row.evidenceEndLine, r.evidenceEndCol = row.evidenceEndCol, r.resolverName = row.resolverName, r.resolverVersion = row.resolverVersion, r.alternativeCandidateIdsJson = row.alternativeCandidateIdsJson, r.unresolvedExpression = row.unresolvedExpression, r.propertiesJson = row.propertiesJson, r.syntheticTarget = true;'
        );
        lines.push('');
      }
    }
  }

  if (document.groupMemberships.length > 0) {
    assertAllowedRelType('MEMBER_OF');
    for (const batch of chunk(document.groupMemberships, CYPHER_BATCH_SIZE)) {
      lines.push('UNWIND [');
      for (let i = 0; i < batch.length; i++) {
        const membership = batch[i];
        const row = [`groupId: ${cypherValue(membership.groupId)}`, `nodeId: ${cypherValue(membership.nodeId)}`].join(', ');
        lines.push(`  {${row}}${i < batch.length - 1 ? ',' : ''}`);
      }
      lines.push('] AS row');
      lines.push('MATCH (member:RepoDNAEntity {id: row.nodeId})');
      lines.push('MATCH (group:RepoDNAGroup {id: row.groupId})');
      lines.push('MERGE (member)-[:MEMBER_OF]->(group);');
      lines.push('');
    }
  }

  const text = lines.join('\n');
  if (/\bDETACH\s+DELETE\b/i.test(text) && !text.includes('//')) {
    throw new Error('Generated Cypher contains unexpected destructive statement');
  }
  const bytes = utf8Bytes(text);
  const sha256 = await sha256Hex(bytes);
  return {
    format: 'cypher',
    filename: graphExportFilename(document.manifest, 'cypher'),
    mediaType: GRAPH_EXPORT_MEDIA_TYPES.cypher,
    bytes,
    byteSize: bytes.byteLength,
    sha256,
  };
}
