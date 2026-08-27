/**
 * Integration fixture: Neo4j Cypher export for the double-import idempotency harness.
 *
 * Runs everywhere (pure static assertions, no Docker required):
 *  - builds a hostile + representative GraphExportDocumentV1 in-file,
 *  - calls the REAL buildCypher(),
 *  - writes cypher.txt + counts.json sidecar into tests/integration/generated/
 *    (consumed by run-neo4j-double-import.mjs),
 *  - statically proves every hostile payload (quotes, backslashes, newlines,
 *    control chars, Unicode separators, `']; MATCH (n) DETACH DELETE n //`)
 *    lives ONLY inside escaped single-quoted string literals, and that exactly
 *    the expected number of statements is produced with zero injected extras.
 *
 * The generated folder is removed again in afterEach UNLESS
 * REPODNA_KEEP_EXPORT_FIXTURES=1 is exported (used by the Neo4j harness).
 * Plain `npm run test:unit` therefore never leaves artifacts behind.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildCypher } from '../../app/lib/export/graph/cypher';
import { GRAPH_EXPORT_SCHEMA_VERSION } from '../../app/lib/export/graph/types';
import type {
  GraphExportDocumentV1,
  GraphExportFile,
} from '../../app/lib/export/graph/types';

const GENERATED_DIR = resolve(import.meta.dirname, 'generated');
const KEEP_FLAG = process.env.REPODNA_KEEP_EXPORT_FIXTURES === '1';

/** Canonical attempted-injection payload required by the task spec. */
const PAYLOAD_INJECTION = "']; MATCH (n) DETACH DELETE n //";
/** Hostile multi-class payload carried by the evil node name. */
const HOSTILE_NAME = [
  "O'Brien \\ \"quoted\"",
  'line1\nline2\r\nline3\tEND',
  'NUL:\u0000 BEL:\u0007 ESC:\u001b',
  '\u2028\u2029 ✅ 𝕏',
  PAYLOAD_INJECTION,
].join('|');
/** Delete-only variant (variety over the DETACH DELETE payload above). */
const PAYLOAD_DELETE = "'); MATCH (x:RepoDNAEntity) DELETE x; //";

function makeNode(
  id: string,
  kind: GraphExportDocumentV1['nodes'][number]['kind'],
  overrides: Partial<GraphExportDocumentV1['nodes'][number]> = {},
): GraphExportDocumentV1['nodes'][number] {
  return {
    id,
    kind,
    name: `name-of-${id}`,
    qualifiedName: `qn://${id}`,
    path: `src/${id}.txt`,
    language: 'plaintext',
    range: { startLine: 1, startCol: 1, endLine: 2, endCol: 3 },
    confidence: 0.75,
    evidence: [`evidence for ${id}`],
    properties: {},
    communityIds: [],
    architectureGroupIds: [],
    ...overrides,
  };
}

function makeRelationship(
  id: string,
  sourceId: string,
  targetId: string | null,
  type: GraphExportDocumentV1['relationships'][number]['type'],
  overrides: Partial<GraphExportDocumentV1['relationships'][number]> = {},
): GraphExportDocumentV1['relationships'][number] {
  const status =
    targetId === null ? ('unresolved' as const) : ('resolved' as const);
  return {
    id,
    sourceId,
    targetId,
    sourceName: `src-name-${sourceId}`,
    sourceKind: 'file',
    sourcePath: `src/${sourceId}`,
    targetName: targetId === null ? null : `tgt-name-${targetId}`,
    targetKind: targetId === null ? null : 'class',
    targetPath: targetId === null ? null : `src/${targetId}`,
    type,
    status,
    confidence: 0.9,
    why: `why ${id}`,
    evidenceFile: `${sourceId}.evidence`,
    evidenceRange: { startLine: 3, startCol: 1, endLine: 4, endCol: 2 },
    resolverName: 'integration-resolver',
    resolverVersion: '1.0.0',
    alternativeCandidateIds: [],
    unresolvedExpression: null,
    properties: {},
    ...overrides,
  };
}

/**
 * Hostile + representative export document.
 * Satisfies assertExportableDocument(): unique ascending ids, refs exist,
 * null-target relationships unresolved/ambiguous, counts equal lengths,
 * sourceArtifactSha256 is a sha-256 hex digest.
 */
function buildFixtureDocument(): GraphExportDocumentV1 {
  const idPlain = '0-repodna-it/plain-file.txt';
  const idEvil = `1-evil${PAYLOAD_INJECTION}`;
  const idClass = '2-domain/Aggregator.ts';
  const idFunc = '9-util/helper.ts';
  // Lexicographically ascending + unique: '0-' < '1-e' < '2-' < '9-'.
  const nodes: GraphExportDocumentV1['nodes'] = [
    makeNode(idPlain, 'file'),
    makeNode(idEvil, 'file', {
      name: HOSTILE_NAME,
      qualifiedName: `qn://${PAYLOAD_INJECTION}`,
      path: `weird\\path '${idEvil}'.txt`,
      language: "type'script",
      properties: { 'Evil"Key': PAYLOAD_INJECTION, nested: { arr: ['ok', '𝕏'] } },
      communityIds: ['c1'],
    }),
    makeNode(idClass, 'class'),
    makeNode(idFunc, 'function'),
  ];

  // Ascending ids: 'a-' < 'b-' < 'c-'.
  const relationships: GraphExportDocumentV1['relationships'] = [
    makeRelationship('a-rel-contained', idPlain, idClass, 'CONTAINS'),
    makeRelationship('b-rel-imports', idPlain, idEvil, 'IMPORTS', {
      status: 'inferred',
      why: `hostile why ${PAYLOAD_DELETE}`,
      evidenceFile: "evil'\n evidence.file",
      properties: { marker: PAYLOAD_INJECTION },
      alternativeCandidateIds: [idClass],
    }),
    makeRelationship('c-rel-unresolved-call', idPlain, null, 'CALLS', {
      why: 'unresolved call needs a placeholder node',
      unresolvedExpression: PAYLOAD_DELETE,
      alternativeCandidateIds: [idClass],
      properties: {},
    }),
  ];

  // Ascending: 'g1-' < 'g2-'.
  const groups: GraphExportDocumentV1['groups'] = [
    {
      id: 'g1-community-main',
      groupType: 'community',
      label: `grp' ${PAYLOAD_INJECTION}`,
      cohesion: 0.42,
      architectureType: null,
      confidence: 0.8,
      evidence: ['community-0'],
      properties: {},
    },
    {
      id: 'g2-architecture-core',
      groupType: 'architecture',
      label: 'architecture/core',
      cohesion: null,
      architectureType: 'layer',
      confidence: 0.55,
      evidence: [],
      properties: { tier: 2 },
    },
  ];

  const groupMemberships: GraphExportDocumentV1['groupMemberships'] = [
    { groupId: 'g1-community-main', nodeId: idPlain, membershipReason: 'community-detection' },
    { groupId: 'g2-architecture-core', nodeId: idClass, membershipReason: 'architecture-file-membership' },
  ];

  const unresolved: GraphExportDocumentV1['unresolved'] = [
    {
      edgeId: 'c-rel-unresolved-call',
      sourceId: idPlain,
      relationshipType: 'CALLS',
      reason: 'dynamic-dispatch',
      unresolvedExpression: PAYLOAD_DELETE,
      candidateIds: [idClass],
      evidenceFile: 'call-site.evidence',
      evidenceRange: { startLine: 10, startCol: 5, endLine: 10, endCol: 40 },
    },
  ];

  const manifest: GraphExportDocumentV1['manifest'] = {
    exportSchemaVersion: GRAPH_EXPORT_SCHEMA_VERSION,
    exporterVersion: '1.0.0',
    sourceSchemaVersion: '2.0.0',
    analyzerVersion: 'integration-fixture',
    sourceArtifactSha256: createHash('sha256')
      .update('repodna-neo4j-idempotency-fixture')
      .digest('hex'),
    repository: {
      name: 'RepoDNA integration fixture',
      source: 'local://tests/integration',
      commitSha: null,
      analyzedRef: 'refs/heads/main',
    },
    analyzedAt: '2026-08-26T00:00:00.000Z',
    coverage: { percentage: 100, truncationReasons: [] },
    completeness: { status: 'complete', reasons: [] },
    executedRepositoryCode: false,
    adaptedFromLegacy: false,
    ordering: 'stable-id-ascending',
    csvFormulaEscaping: 'apostrophe-prefix-on-formula-leading-characters',
    counts: {
      nodes: nodes.length,
      relationships: relationships.length,
      groups: groups.length,
      groupMemberships: groupMemberships.length,
      unresolved: unresolved.length,
    },
  };

  return { manifest, nodes, relationships, groups, groupMemberships, unresolved };
}

/* ------------------------------------------------------------------ *
 * Minimal single-quoted-Cypher string lexer.                          *
 * Produces a per-character mask: 1 iff inside a string literal.       *
 * ------------------------------------------------------------------ */
interface StringScan {
  mask: Uint8Array;
  /** false if EOF reached while still inside a literal (unterminated). */
  terminated: boolean;
  /** Characters seen OUTSIDE literals (structural-code channel only). */
  outsideChars: string[];
}

function scanCypherStringLiterals(text: string): StringScan {
  const mask = new Uint8Array(text.length);
  const outsideChars: string[] = [];
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (!inString) {
      if (ch === "'") {
        inString = true;
        mask[i] = 1;
      } else {
        outsideChars.push(ch);
      }
      i += 1;
    } else {
      mask[i] = 1;
      if (ch === '\\') {
        if (i + 1 < text.length) {
          mask[i + 1] = 1; // escaped char stays inside the literal
          i += 2;
        } else {
          i += 1;
        }
      } else if (ch === "'") {
        inString = false;
        i += 1;
      } else {
        i += 1;
      }
    }
  }
  return { mask, terminated: !inString, outsideChars };
}

/** Splits on ';' characters that sit OUTSIDE any string literal. */
function topLevelSegments(text: string, scan: StringScan): string[] {
  const segments: string[] = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ';' && scan.mask[i] === 0) {
      segments.push(current);
      current = '';
    } else {
      current += text[i];
    }
  }
  segments.push(current);
  return segments;
}

/** Keeps only out-of-literal characters => code skeleton without any data. */
function skeleton(segment: string, startOffset: number, scan: StringScan): string {
  let out = '';
  for (let i = 0; i < segment.length; i++) {
    if (scan.mask[startOffset + i] === 0) out += segment[i];
  }
  return out;
}

const SKELETON_LINE_PATTERNS: RegExp[] = [
  /^$/, // blank separator lines
  /^\/\/($|\s)/, // header comment lines
  /^CREATE CONSTRAINT repo_dna_(entity|group|unresolved)_id IF NOT EXISTS FOR \(n:(RepoDNAEntity|RepoDNAGroup|RepoDNAUnresolved)\) REQUIRE n\.id IS UNIQUE$/,
  /^UNWIND \[$/,
  /^\] AS row$/,
  /^MATCH \(source:RepoDNAEntity \{id: row\.sourceId\}\)$/,
  /^MATCH \(target:RepoDNAEntity \{id: row\.targetId\}\)$/,
  /^MATCH \(target:RepoDNAUnresolved \{id: row\.unresolvedId\}\)$/,
  /^MATCH \(member:RepoDNAEntity \{id: row\.nodeId\}\)$/,
  /^MATCH \(group:RepoDNAGroup \{id: row\.groupId\}\)$/,
  /^MERGE \(n:RepoDNAEntity:`.+?` \{id: row\.id\}\)$/,
  /^MERGE \(n:RepoDNAGroup \{id: row\.id\}\)$/,
  /^MERGE \(n:RepoDNAUnresolved \{id: row\.id\}\)$/,
  /^MERGE \(source\)-\[r:`.+?` \{id: row\.id\}\]->\(target\)$/,
  /^MERGE \(member\)-\[:MEMBER_OF\]->\(group\)$/,
  /^SET [nr]\.[A-Za-z]+ = (?:row\.[A-Za-z]+|true|false)(?:, [nr]\.[A-Za-z]+ = (?:row\.[A-Za-z]+|true|false))*$/,
  // UNWIND row shells: string values are stripped as literals, leaving only
  // field names and any numeric/null/true/false values on each line.
  /^\s*\{[a-zA-Z_][a-zA-Z0-9_]*: \s*(?:[0-9]+(?:\.[0-9]+)?|null|true|false)?(?:, [a-zA-Z_][a-zA-Z0-9_]*: \s*(?:[0-9]+(?:\.[0-9]+)?|null|true|false)?)*\},?\s*$/,
];

function assertSkeletonWhitelisted(label: string, skel: string): void {
  for (const line of skel.split('\n')) {
    const ok = SKELETON_LINE_PATTERNS.some((re) => re.test(line));
    expect(ok, `${label}: non-whitelisted top-level skeleton line: ${JSON.stringify(line)}`).toBe(true);
  }
}

describe('Neo4j cypher export fixture (static, environment-independent)', () => {
  let fixture: GraphExportDocumentV1;
  let file: GraphExportFile;
  let text: string;

  beforeAll(async () => {
    fixture = buildFixtureDocument();
    file = await buildCypher(fixture);
    text = Buffer.from(file.bytes).toString('utf8');

    // Deterministic artifacts shared with run-neo4j-double-import.mjs.
    const manifestCounts = fixture.manifest.counts;
    const unresolvedPlaceholders =
      fixture.relationships.filter((rel) => rel.targetId === null).length;
    rmSync(GENERATED_DIR, { recursive: true, force: true });
    mkdirSync(GENERATED_DIR, { recursive: true });
    writeFileSync(join(GENERATED_DIR, 'cypher.txt'), text, 'utf8');
    const sidecar = {
      // Manifest-semantics keys (spec-mandated).
      nodes: manifestCounts.nodes,
      // resolved + synthetic-unresolved relationship rows; memberships excluded.
      relationships: manifestCounts.relationships,
      groups: manifestCounts.groups,
      unresolved: unresolvedPlaceholders,
      groupMemberships: manifestCounts.groupMemberships,
      // What Neo4j must show post-import; label constants live in
      // app/lib/export/graph/cypher.ts.
      neo4jExpected: {
        RepoDNAEntity: manifestCounts.nodes,
        RepoDNAGroup: manifestCounts.groups,
        RepoDNAUnresolved: unresolvedPlaceholders,
        allRelationships: manifestCounts.relationships + manifestCounts.groupMemberships,
        memberOfRelationships: manifestCounts.groupMemberships,
        injectionProbeHostileNamedEntities: 1,
        namedConstraints: [
          'repo_dna_entity_id',
          'repo_dna_group_id',
          'repo_dna_unresolved_id',
        ],
      },
      cypherSha256: file.sha256,
      byteSize: file.byteSize,
      filename: file.filename,
    };
    writeFileSync(join(GENERATED_DIR, 'counts.json'), `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8');
  });

  afterEach(() => {
    if (!KEEP_FLAG) rmSync(GENERATED_DIR, { recursive: true, force: true });
  });

  afterAll(() => {
    if (!KEEP_FLAG) rmSync(GENERATED_DIR, { recursive: true, force: true });
  });

  it('emits count-consistent output matching the export manifest', () => {
    expect(file.mediaType).toBe('text/plain; charset=utf-8');
    expect(file.filename).toMatch(/-repodna-cypher\.txt$/);
    expect(text).toContain(
      `// Counts: nodes=${fixture.manifest.counts.nodes} relationships=${fixture.manifest.counts.relationships} groups=${fixture.manifest.counts.groups} memberships=${fixture.manifest.counts.groupMemberships} unresolved=${fixture.manifest.counts.unresolved}`,
    );
    expect(text).toContain('MERGE (n:RepoDNAEntity:');
    expect(text).toContain('MERGE (n:RepoDNAGroup {id: row.id})');
    expect(text).toContain('MERGE (n:RepoDNAUnresolved {id: row.id})');
    expect(text).toContain('MERGE (member)-[:MEMBER_OF]->(group);');
    expect(text).toContain(
      'CREATE CONSTRAINT repo_dna_unresolved_id IF NOT EXISTS FOR (n:RepoDNAUnresolved) REQUIRE n.id IS UNIQUE;',
    );
  });

  it('escapes every hostile payload into string literals only (lexer-proven)', () => {
    const scan = scanCypherStringLiterals(text);
    expect(scan.terminated).toBe(true);

    // Fragments with NO escapable characters survive verbatim inside literals.
    // NOTE: fragments whose FIRST char is an apostrophe can still be found
    // verbatim — indexOf lands on the escaped quote (`\'`) position and the
    // remainder matches raw — which is itself proof of correct escaping.
    const dangerousFragments = [
      "]; MATCH (n) DETACH DELETE n //", // PAYLOAD_INJECTION core
      'MATCH (n) DETACH DELETE n',
      "); MATCH (x:RepoDNAEntity) DELETE x;", // PAYLOAD_DELETE core
      'DETACH DELETE',
      '𝕏',
    ];
    for (const fragment of dangerousFragments) {
      let searchFrom = 0;
      let occurrences = 0;
      for (;;) {
        const idx = text.indexOf(fragment, searchFrom);
        if (idx === -1) break;
        occurrences += 1;
        for (let k = idx; k < idx + fragment.length; k++) {
          expect(
            scan.mask[k],
            `char ${k} of ${JSON.stringify(fragment)} must sit inside a string literal`,
          ).toBe(1);
        }
        searchFrom = idx + 1;
      }
      expect(occurrences, `fragment ${JSON.stringify(fragment)} should appear`).toBeGreaterThan(0);
    }

    // Escape-rendered evidence: payloads containing quotes/backslashes/controls
    // must appear in escaped form only, entirely inside literals. Verified
    // against actual exporter output: double quotes are intentionally NOT
    // escaped inside single-quoted Cypher literals.
    const escapedNeedles = [
      "\\']; MATCH (n) DETACH DELETE n //",
      "\\'); MATCH (x:RepoDNAEntity) DELETE x; //",
      "O\\'Brien \\\\ \"quoted\"",
      '\\n',
      '\\r\\n',
      '\\u0000',
      '\\u0007',
      '\\u001b',
      '\\u2028\\u2029',
    ];
    for (const needle of escapedNeedles) {
      const idx = text.indexOf(needle);
      expect(idx, `escaped needle ${JSON.stringify(needle)} must appear`).toBeGreaterThanOrEqual(0);
      for (let k = idx; k < idx + needle.length; k++) {
        expect(
          scan.mask[k],
          `escaped needle ${JSON.stringify(needle)} char ${k} must sit inside a string literal`,
        ).toBe(1);
      }
    }

    // Raw hostile bytes must NEVER surface verbatim...
    expect(text.includes('\u0000')).toBe(false);
    expect(text.includes('\u0007')).toBe(false);
    expect(text.includes('\u001b')).toBe(false);
    expect(text.includes('\u2028')).toBe(false);
    expect(text.includes('\u2029')).toBe(false);
    expect(text.includes('\r')).toBe(false);
    expect(text.includes('\t')).toBe(false);
    // ...and everything outside literals is printable structure or '\n'.
    for (const ch of scan.outsideChars) {
      const code = ch.charCodeAt(0);
      const structuralOk = ch === '\n' || (code >= 0x20 && code !== 0x7f);
      expect(
        structuralOk,
        `non-literal char U+${code.toString(16).padStart(4, '0')} leaked outside a literal`,
      ).toBe(true);
    }

    // Escaping evidence required by the exporter contract.
    expect(text).toContain("\\'");
    expect(text).toContain('\\\\');
    expect(text).toContain('\\n');
    expect(text).toContain('\\r\\n');
    expect(text).toContain('\\u0000');
    expect(text).toContain('\\u2028\\u2029');
  });

  it('produces exactly the expected statements with zero injected extras', () => {
    const scan = scanCypherStringLiterals(text);
    const segments = topLevelSegments(text, scan);

    // Fixture-static math mirroring cypher.ts batcher:
    //   3 constraints
    // + 3 entity batches (kind buckets present: class, file, function)
    // + 1 group batch
    // + 1 unresolved-placeholder-node batch
    // + 2 resolved-relationship batches (CONTAINS, IMPORTS)
    // + 1 synthetic-unresolved-relationship batch (CALLS)
    // + 1 membership batch = 12 statements (+1 trailing empty segment).
    const EXPECTED_STATEMENTS = 12;
    expect(segments.length - 1).toBe(EXPECTED_STATEMENTS);

    // The leading comment header is NOT its own segment: the first
    // ';'-terminated segment begins with the header comments (each on its own
    // line) and ends with the first CREATE CONSTRAINT statement. Verify the
    // comment block is intact, then whitelist the whole segment skeleton.
    const headerLines = segments[0].split('\n');
    expect(headerLines[0].startsWith('// RepoDNA Graph Export — Cypher')).toBe(true);
    const commentEnd = headerLines.findIndex((line) => line !== '' && !line.startsWith('//'));
    expect(commentEnd).toBeGreaterThanOrEqual(1);
    for (const line of headerLines.slice(0, commentEnd)) {
      expect(line === '' || line.startsWith('//'), `malformed header line: ${JSON.stringify(line)}`).toBe(true);
    }
    expect(headerLines[commentEnd].startsWith('CREATE CONSTRAINT repo_dna_entity_id')).toBe(true);

    let offset = 0;
    for (let s = 0; s < segments.length; s++) {
      if (s > 0) offset += segments[s - 1].length + 1; // +1 consumes the ';'
      assertSkeletonWhitelisted(`segment #${s}`, skeleton(segments[s], offset, scan));
    }

    // The hostile id literal opened escaped; payload quotes never close it.
    expect(text).toContain("id: '1-evil\\']");
    // Proof of no injected destructive statement: a MASK-AWARE splitter (the
    // same one the skeleton whitelist uses) must find no top-level segment
    // whose non-literal skeleton is a destructive statement. (A naive ';'
    // splitter would split mid-literal — the payload genuinely contains ';'
    // inside its string literal — so it cannot be used as an injection probe.)
    const scanForInjection = scanCypherStringLiterals(text);
    const injectedSegments = topLevelSegments(text, scanForInjection).filter(
      (seg) => /^\s*(MATCH\s+\([^)]*\)\s+DETACH\s+DELETE|DETACH\s+DELETE)/i.test(seg.replace(/\s+/g, ' ').trim()),
    );
    expect(injectedSegments).toHaveLength(0);
  });
});
