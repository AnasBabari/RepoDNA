import { zip } from 'fflate';

import { compactStableStringify, sha256Hex, stableStringify, utf8Bytes } from './stable-json';
import { graphExportFilename } from './index';
import { GRAPH_EXPORT_MEDIA_TYPES } from './types';
import type { GraphExportDocumentV1, GraphExportFile } from './types';
import { assertExportableDocument } from './validate';

const FIXED_MTIME = new Date('1980-01-01T00:00:00.000Z');
const FORMULA_PREFIX_RE = /^\s*[=+\-@\t\r]/;

function protectFormula(value: string): string {
  if (value.length === 0) return value;
  const trimmed = value.trimStart();
  if (trimmed.length === 0) return value;
  const first = trimmed[0];
  if (first === '=' || first === '+' || first === '-' || first === '@' || first === '\t' || first === '\r') {
    return `'${value}`;
  }
  return value;
}

function escapeCsvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  text = protectFormula(text);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvString(rows: string[][]): string {
  if (rows.length === 0) return '';
  return rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(',')).join('\r\n') + '\r\n';
}

function evidenceFileForCsv(relationship: GraphExportDocumentV1['relationships'][number]): string {
  return relationship.evidenceFile;
}

export async function buildCsvBundle(document: GraphExportDocumentV1): Promise<GraphExportFile> {
  assertExportableDocument(document);

  const nodesHeader = [
    'id',
    'kind',
    'name',
    'qualified_name',
    'path',
    'language',
    'start_line',
    'start_col',
    'end_line',
    'end_col',
    'confidence',
    'evidence_json',
    'properties_json',
    'community_ids_json',
    'architecture_group_ids_json',
  ];
  const nodesRows: string[][] = [nodesHeader];
  for (const node of document.nodes) {
    nodesRows.push([
      node.id,
      node.kind,
      node.name,
      node.qualifiedName,
      node.path,
      node.language,
      String(node.range.startLine),
      String(node.range.startCol),
      String(node.range.endLine),
      String(node.range.endCol),
      node.confidence === null ? '' : String(node.confidence),
      compactStableStringify(node.evidence),
      compactStableStringify(node.properties),
      compactStableStringify(node.communityIds),
      compactStableStringify(node.architectureGroupIds),
    ]);
  }

  const relHeader = [
    'id',
    'source_id',
    'source_name',
    'source_kind',
    'source_path',
    'target_id',
    'target_name',
    'target_kind',
    'target_path',
    'type',
    'status',
    'confidence',
    'why',
    'evidence_file',
    'evidence_start_line',
    'evidence_start_col',
    'evidence_end_line',
    'evidence_end_col',
    'resolver_name',
    'resolver_version',
    'alternative_candidate_ids_json',
    'unresolved_expression',
    'properties_json',
  ];
  const relRows: string[][] = [relHeader];
  for (const rel of document.relationships) {
    relRows.push([
      rel.id,
      rel.sourceId,
      rel.sourceName,
      rel.sourceKind ?? '',
      rel.sourcePath,
      rel.targetId ?? '',
      rel.targetName ?? '',
      rel.targetKind ?? '',
      rel.targetPath ?? '',
      rel.type,
      rel.status,
      String(rel.confidence),
      rel.why,
      evidenceFileForCsv(rel),
      String(rel.evidenceRange.startLine),
      String(rel.evidenceRange.startCol),
      String(rel.evidenceRange.endLine),
      String(rel.evidenceRange.endCol),
      rel.resolverName,
      rel.resolverVersion,
      compactStableStringify(rel.alternativeCandidateIds),
      rel.unresolvedExpression ?? '',
      compactStableStringify(rel.properties),
    ]);
  }

  const groupsHeader = ['id', 'group_type', 'label', 'cohesion', 'architecture_type', 'confidence', 'evidence_json', 'properties_json'];
  const groupsRows: string[][] = [groupsHeader];
  for (const group of document.groups) {
    groupsRows.push([
      group.id,
      group.groupType,
      group.label,
      group.cohesion === null ? '' : String(group.cohesion),
      group.architectureType ?? '',
      group.confidence === null ? '' : String(group.confidence),
      compactStableStringify(group.evidence),
      compactStableStringify(group.properties),
    ]);
  }

  const membershipsHeader = ['group_id', 'node_id', 'membership_reason'];
  const membershipsRows: string[][] = [membershipsHeader];
  for (const membership of document.groupMemberships) {
    membershipsRows.push([membership.groupId, membership.nodeId, membership.membershipReason]);
  }

  const unresolvedHeader = [
    'edge_id',
    'source_id',
    'relationship_type',
    'reason',
    'unresolved_expression',
    'candidate_ids_json',
    'evidence_file',
    'evidence_start_line',
    'evidence_start_col',
    'evidence_end_line',
    'evidence_end_col',
  ];
  const unresolvedRows: string[][] = [unresolvedHeader];
  for (const entry of document.unresolved) {
    unresolvedRows.push([
      entry.edgeId,
      entry.sourceId,
      entry.relationshipType,
      entry.reason,
      entry.unresolvedExpression ?? '',
      compactStableStringify(entry.candidateIds),
      entry.evidenceFile,
      String(entry.evidenceRange.startLine),
      String(entry.evidenceRange.startCol),
      String(entry.evidenceRange.endLine),
      String(entry.evidenceRange.endCol),
    ]);
  }

  const nodesCsv = csvString(nodesRows);
  const relationshipsCsv = csvString(relRows);
  const groupsCsv = csvString(groupsRows);
  const membershipsCsv = csvString(membershipsRows);
  const unresolvedCsv = csvString(unresolvedRows);

  const nodesBytes = utf8Bytes(nodesCsv);
  const relationshipsBytes = utf8Bytes(relationshipsCsv);
  const groupsBytes = utf8Bytes(groupsCsv);
  const membershipsBytes = utf8Bytes(membershipsCsv);
  const unresolvedBytes = utf8Bytes(unresolvedCsv);

  const manifestPayload = {
    ...document.manifest,
    files: [
      { name: 'nodes.csv', byteSize: nodesBytes.byteLength, sha256: await sha256Hex(nodesBytes) },
      { name: 'relationships.csv', byteSize: relationshipsBytes.byteLength, sha256: await sha256Hex(relationshipsBytes) },
      { name: 'groups.csv', byteSize: groupsBytes.byteLength, sha256: await sha256Hex(groupsBytes) },
      { name: 'group_memberships.csv', byteSize: membershipsBytes.byteLength, sha256: await sha256Hex(membershipsBytes) },
      { name: 'unresolved.csv', byteSize: unresolvedBytes.byteLength, sha256: await sha256Hex(unresolvedBytes) },
    ],
  };
  const manifestJson = stableStringify(manifestPayload, 2);
  const manifestBytes = utf8Bytes(manifestJson);

  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(
      {
        'manifest.json': [manifestBytes, { mtime: FIXED_MTIME }],
        'nodes.csv': [nodesBytes, { mtime: FIXED_MTIME }],
        'relationships.csv': [relationshipsBytes, { mtime: FIXED_MTIME }],
        'groups.csv': [groupsBytes, { mtime: FIXED_MTIME }],
        'group_memberships.csv': [membershipsBytes, { mtime: FIXED_MTIME }],
        'unresolved.csv': [unresolvedBytes, { mtime: FIXED_MTIME }],
      },
      { level: 9, mtime: FIXED_MTIME },
      (error, data) => {
        if (error) reject(error);
        else resolve(data);
      }
    );
  });

  const sha256 = await sha256Hex(zipped);
  return {
    format: 'csv',
    filename: graphExportFilename(document.manifest, 'csv'),
    mediaType: GRAPH_EXPORT_MEDIA_TYPES.csv,
    bytes: zipped,
    byteSize: zipped.byteLength,
    sha256,
  };
}
