import { zip } from 'fflate';

import { graphExportFilename } from './index';
import { compactStableStringify, sha256Hex, stableStringify, utf8Bytes } from './stable-json';
import { GRAPH_EXPORT_MEDIA_TYPES, GraphExportError } from './types';
import type { GraphExportDocumentV1, GraphExportFile } from './types';
import { assertExportableDocument } from './validate';

const FIXED_MTIME = new Date('1980-01-01T00:00:00.000Z');
const PARQUET_ROW_GROUP_SIZE = 1000;

type ParquetPrimitiveType = 'STRING' | 'INT32' | 'DOUBLE';
type ParquetValue = string | number | null;

interface ParquetColumn {
  name: string;
  type: ParquetPrimitiveType;
  data: ParquetValue[];
}

interface ParquetTable {
  name: string;
  filename: string;
  description: string;
  columns: ParquetColumn[];
}

function byId<T extends { id: string }>(items: T[]): T[] {
  return items.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function jsonValue(value: unknown): string {
  return compactStableStringify(value);
}

function stringColumn(name: string, data: Array<string | null>): ParquetColumn {
  return { name, type: 'STRING', data };
}

function intColumn(name: string, data: Array<number | null>): ParquetColumn {
  return { name, type: 'INT32', data };
}

function doubleColumn(name: string, data: Array<number | null>): ParquetColumn {
  return { name, type: 'DOUBLE', data };
}

function buildTables(document: GraphExportDocumentV1): ParquetTable[] {
  const nodes = byId(document.nodes);
  const relationships = byId(document.relationships);
  const groups = byId(document.groups);
  const memberships = document.groupMemberships.slice().sort((a, b) => {
    if (a.groupId !== b.groupId) return a.groupId < b.groupId ? -1 : 1;
    if (a.nodeId !== b.nodeId) return a.nodeId < b.nodeId ? -1 : 1;
    return a.membershipReason < b.membershipReason ? -1 : a.membershipReason > b.membershipReason ? 1 : 0;
  });
  const unresolved = document.unresolved.slice().sort((a, b) =>
    a.edgeId < b.edgeId ? -1 : a.edgeId > b.edgeId ? 1 : 0
  );

  return [
    {
      name: 'nodes',
      filename: 'nodes.parquet',
      description: 'Analyzed entities with source ranges, confidence, properties, and group references.',
      columns: [
        stringColumn('id', nodes.map((node) => node.id)),
        stringColumn('kind', nodes.map((node) => node.kind)),
        stringColumn('name', nodes.map((node) => node.name)),
        stringColumn('qualified_name', nodes.map((node) => node.qualifiedName)),
        stringColumn('path', nodes.map((node) => node.path)),
        stringColumn('language', nodes.map((node) => node.language)),
        intColumn('start_line', nodes.map((node) => node.range.startLine)),
        intColumn('start_col', nodes.map((node) => node.range.startCol)),
        intColumn('end_line', nodes.map((node) => node.range.endLine)),
        intColumn('end_col', nodes.map((node) => node.range.endCol)),
        doubleColumn('confidence', nodes.map((node) => node.confidence)),
        stringColumn('evidence_json', nodes.map((node) => jsonValue(node.evidence))),
        stringColumn('properties_json', nodes.map((node) => jsonValue(node.properties))),
        stringColumn('community_ids_json', nodes.map((node) => jsonValue(node.communityIds))),
        stringColumn('architecture_group_ids_json', nodes.map((node) => jsonValue(node.architectureGroupIds))),
      ],
    },
    {
      name: 'relationships',
      filename: 'relationships.parquet',
      description: 'Resolved and unresolved links, including explanation, evidence, resolver, and properties.',
      columns: [
        stringColumn('id', relationships.map((relationship) => relationship.id)),
        stringColumn('source_id', relationships.map((relationship) => relationship.sourceId)),
        stringColumn('source_name', relationships.map((relationship) => relationship.sourceName)),
        stringColumn('source_kind', relationships.map((relationship) => relationship.sourceKind)),
        stringColumn('source_path', relationships.map((relationship) => relationship.sourcePath)),
        stringColumn('target_id', relationships.map((relationship) => relationship.targetId)),
        stringColumn('target_name', relationships.map((relationship) => relationship.targetName)),
        stringColumn('target_kind', relationships.map((relationship) => relationship.targetKind)),
        stringColumn('target_path', relationships.map((relationship) => relationship.targetPath)),
        stringColumn('type', relationships.map((relationship) => relationship.type)),
        stringColumn('status', relationships.map((relationship) => relationship.status)),
        doubleColumn('confidence', relationships.map((relationship) => relationship.confidence)),
        stringColumn('why', relationships.map((relationship) => relationship.why)),
        stringColumn('evidence_file', relationships.map((relationship) => relationship.evidenceFile)),
        intColumn('evidence_start_line', relationships.map((relationship) => relationship.evidenceRange.startLine)),
        intColumn('evidence_start_col', relationships.map((relationship) => relationship.evidenceRange.startCol)),
        intColumn('evidence_end_line', relationships.map((relationship) => relationship.evidenceRange.endLine)),
        intColumn('evidence_end_col', relationships.map((relationship) => relationship.evidenceRange.endCol)),
        stringColumn('resolver_name', relationships.map((relationship) => relationship.resolverName)),
        stringColumn('resolver_version', relationships.map((relationship) => relationship.resolverVersion)),
        stringColumn(
          'alternative_candidate_ids_json',
          relationships.map((relationship) => jsonValue(relationship.alternativeCandidateIds))
        ),
        stringColumn('unresolved_expression', relationships.map((relationship) => relationship.unresolvedExpression)),
        stringColumn('properties_json', relationships.map((relationship) => jsonValue(relationship.properties))),
      ],
    },
    {
      name: 'groups',
      filename: 'groups.parquet',
      description: 'Community and architecture group definitions with cohesion, confidence, and evidence.',
      columns: [
        stringColumn('id', groups.map((group) => group.id)),
        stringColumn('group_type', groups.map((group) => group.groupType)),
        stringColumn('label', groups.map((group) => group.label)),
        doubleColumn('cohesion', groups.map((group) => group.cohesion)),
        stringColumn('architecture_type', groups.map((group) => group.architectureType)),
        doubleColumn('confidence', groups.map((group) => group.confidence)),
        stringColumn('evidence_json', groups.map((group) => jsonValue(group.evidence))),
        stringColumn('properties_json', groups.map((group) => jsonValue(group.properties))),
      ],
    },
    {
      name: 'group_memberships',
      filename: 'group_memberships.parquet',
      description: 'Many-to-many node-to-group memberships and the reason each membership exists.',
      columns: [
        stringColumn('group_id', memberships.map((membership) => membership.groupId)),
        stringColumn('node_id', memberships.map((membership) => membership.nodeId)),
        stringColumn('membership_reason', memberships.map((membership) => membership.membershipReason)),
      ],
    },
    {
      name: 'unresolved',
      filename: 'unresolved.parquet',
      description: 'Resolution gaps retained as first-class rows instead of being silently omitted.',
      columns: [
        stringColumn('edge_id', unresolved.map((entry) => entry.edgeId)),
        stringColumn('source_id', unresolved.map((entry) => entry.sourceId)),
        stringColumn('relationship_type', unresolved.map((entry) => entry.relationshipType)),
        stringColumn('reason', unresolved.map((entry) => entry.reason)),
        stringColumn('unresolved_expression', unresolved.map((entry) => entry.unresolvedExpression)),
        stringColumn('candidate_ids_json', unresolved.map((entry) => jsonValue(entry.candidateIds))),
        stringColumn('evidence_file', unresolved.map((entry) => entry.evidenceFile)),
        intColumn('evidence_start_line', unresolved.map((entry) => entry.evidenceRange.startLine)),
        intColumn('evidence_start_col', unresolved.map((entry) => entry.evidenceRange.startCol)),
        intColumn('evidence_end_line', unresolved.map((entry) => entry.evidenceRange.endLine)),
        intColumn('evidence_end_col', unresolved.map((entry) => entry.evidenceRange.endCol)),
      ],
    },
  ];
}

async function writeTable(document: GraphExportDocumentV1, table: ParquetTable): Promise<Uint8Array> {
  try {
    const { parquetWriteBuffer } = await import('hyparquet-writer');
    const arrayBuffer = parquetWriteBuffer({
      columnData: table.columns.map((column) => ({
        name: column.name,
        type: column.type,
        data: column.data,
        nullable: true,
        offsetIndex: true,
      })),
      codec: 'SNAPPY',
      rowGroupSize: PARQUET_ROW_GROUP_SIZE,
      statistics: true,
      kvMetadata: [
        { key: 'repodna.export.schema', value: document.manifest.exportSchemaVersion },
        { key: 'repodna.export.table', value: table.name },
        { key: 'repodna.export.source_digest', value: document.manifest.sourceArtifactSha256 },
      ],
    });
    return new Uint8Array(arrayBuffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown Parquet writer error';
    throw new GraphExportError('EXPORT_GENERATION_FAILED', `Could not write ${table.filename}: ${message}`);
  }
}

export async function buildParquetBundle(document: GraphExportDocumentV1): Promise<GraphExportFile> {
  assertExportableDocument(document);
  const tables = buildTables(document);
  const parquetFiles = await Promise.all(
    tables.map(async (table) => {
      const bytes = await writeTable(document, table);
      return {
        table,
        bytes,
        byteSize: bytes.byteLength,
        sha256: await sha256Hex(bytes),
      };
    })
  );

  const manifestPayload = {
    ...document.manifest,
    format: 'parquet',
    parquet: {
      compression: 'SNAPPY',
      rowGroupSize: PARQUET_ROW_GROUP_SIZE,
      nullability: 'All columns are OPTIONAL so null targets, confidence values, and ranges remain lossless.',
      tables: tables.map((table) => ({
        name: table.name,
        filename: table.filename,
        description: table.description,
        columns: table.columns.map(({ name, type }) => ({ name, type, nullable: true })),
      })),
    },
    files: parquetFiles.map(({ table, byteSize, sha256 }) => ({
      name: table.filename,
      byteSize,
      sha256,
    })),
  };
  const manifestBytes = utf8Bytes(stableStringify(manifestPayload, 2));

  const zipEntries: Record<string, [Uint8Array, { mtime: Date }]> = {
    'manifest.json': [manifestBytes, { mtime: FIXED_MTIME }],
  };
  for (const { table, bytes } of parquetFiles) {
    zipEntries[table.filename] = [bytes, { mtime: FIXED_MTIME }];
  }

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(zipEntries, { level: 9, mtime: FIXED_MTIME }, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });

  return {
    format: 'parquet',
    filename: graphExportFilename(document.manifest, 'parquet'),
    mediaType: GRAPH_EXPORT_MEDIA_TYPES.parquet,
    bytes: zipped,
    byteSize: zipped.byteLength,
    sha256: await sha256Hex(zipped),
  };
}
