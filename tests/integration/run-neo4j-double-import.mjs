#!/usr/bin/env node
/**
 * Neo4j 5 Community double-import idempotency verification for RepoDNA exports.
 *
 * Pure Node built-ins only (node:child_process/node:fs/node:crypto/node:net).
 * Manual invocation:
 *
 *   node tests/integration/run-neo4j-double-import.mjs
 *
 * Behavior contract (task_0004 / Phase 3b):
 *  1. Detects `docker version`; when unavailable prints SKIP reason, exits 0.
 *  2. Regenerates tests/integration/generated/{cypher.txt,counts.json} via the
 *     static fixture test with REPODNA_KEEP_EXPORT_FIXTURES=1; verifies the
 *     artifact sha256/byteSize against the sidecar before trusting it.
 *  3. Boots neo4j:5-community with NEO4J_AUTH=neo4j/<random password>,
 *     randomized host ports and a unique container name; polls HTTP :7474 plus
 *     an authenticated bolt roundtrip until ready (hard cap ~120s).
 *  4. Ships cypher.txt into the container (docker cp) and imports it with
 *     `cypher-shell -f` TWICE.
 *  5. Between/after runs executes count queries whose labels mirror the
 *     constants in app/lib/export/graph/cypher.ts (RepoDNAEntity, RepoDNAGroup,
 *     RepoDNAUnresolved, MEMBER_OF) plus SHOW CONSTRAINTS; every count must
 *     equal the sidecar AND be identical before vs. after import #2.
 *  6. Proves hostile payload landed as DATA and fails loudly on injection or
 *     foreign-write evidence.
 *  7. Teardown (`docker rm -f`) always runs — success, failure, or signal.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const GENERATED_DIR = join(REPO_ROOT, 'tests', 'integration', 'generated');
const CYPHER_PATH = join(GENERATED_DIR, 'cypher.txt');
const COUNTS_PATH = join(GENERATED_DIR, 'counts.json');
const NEO4J_IMAGE = 'neo4j:5-community';
const READY_CAP_MS = 120_000;
const QUERY_BUDGET_MS = 180_000;
const LOG_TAIL_CHARS = 4000;

let containerName = '';
let currentPassword = '';
let startedAtMs = 0;
let tornDown = false;

const log = (...parts) => console.log(`[neo4j-harness ${elapsed()}]`, ...parts);
const die = (...parts) => console.error(`[neo4j-harness ${elapsed()}] FAIL:`, ...parts);

function elapsed() {
  if (startedAtMs === 0) return '0.0s';
  return `${((Date.now() - startedAtMs) / 1000).toFixed(1)}s`;
}

/* ----------------------------- helpers ----------------------------- */

function dockerOut(args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Returns the server version, or null when Docker is unusable here. */
function detectDocker() {
  try {
    const result = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    if (result.status === 0 && result.stdout && result.stdout.trim().length > 0) {
      return result.stdout.trim();
    }
    const reason =
      ((result.stderr || '') + (result.stdout || '')).trim().split('\n')[0] ||
      `exit code ${result.status}`;
    console.log(`[neo4j-harness] docker present but daemon unusable: ${reason}`);
    return null;
  } catch (error) {
    console.log(`[neo4j-harness] docker CLI not runnable: ${error?.message ?? error}`);
    return null;
  }
}

/** Grabs an OS-assigned free TCP port to minimize host port conflicts. */
function grabFreePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.unref();
    server.on('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function pickPorts() {
  return { http: await grabFreePort(), bolt: await grabFreePort() };
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function httpStatus(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

function cypherShell(args, input) {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      containerName,
      'cypher-shell',
      '-u',
      'neo4j',
      '-p',
      currentPassword,
      '--database',
      'neo4j',
      '--non-interactive',
      ...args,
    ],
    { encoding: 'utf8', input, maxBuffer: 32 * 1024 * 1024, timeout: QUERY_BUDGET_MS },
  );
}

/** Runs one Cypher query and returns trimmed stdout (--format plain rows). */
function runQuery(query) {
  return cypherShell(['--format', 'plain'], `${query.trim()}\n`).trim();
}

/** Extracts the integer produced by a `RETURN count(x)` style query. */
function countOf(query) {
  const out = runQuery(query);
  const matches = [...out.matchAll(/(\d+)/g)];
  if (matches.length === 0) {
    throw new Error(
      `count query returned no integer. query=${JSON.stringify(query)} output=${JSON.stringify(out)}`,
    );
  }
  return Number(matches[matches.length - 1][1]);
}

/* ---------------------------- lifecycle ---------------------------- */

function teardown(reason) {
  if (tornDown || containerName === '') return;
  tornDown = true;
  try {
    spawnSync('docker', ['rm', '-f', containerName], {
      encoding: 'utf8',
      timeout: 60_000,
      stdio: 'ignore',
    });
    log(`container ${containerName} removed (${reason})`);
  } catch {
    /* best-effort teardown */
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log(`received ${signal}, tearing down before exit`);
    teardown(`signal ${signal}`);
    process.exit(process.exitCode ?? 1);
  });
}

/** Regenerate static fixtures by running the vitest file with the keep flag. */
function regenerateFixturesViaVitest() {
  log('regenerating cypher.txt + counts.json via vitest fixture test...');
  const command =
    process.platform === 'win32'
      ? 'npx.cmd vitest run tests/integration/graph-export-cypher.fixture.test.ts'
      : 'npx vitest run tests/integration/graph-export-cypher.fixture.test.ts';
  const result = spawnSync(command, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: true, // required on Windows so npx.cmd can execute
    env: { ...process.env, REPODNA_KEEP_EXPORT_FIXTURES: '1' },
    timeout: 240_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    die('fixture regeneration failed; vitest output tail:');
    die((((result.stdout || '') + (result.stderr || '')) || '').slice(-LOG_TAIL_CHARS));
    throw new Error('fixture regeneration failed');
  }
}

async function bootContainer(attempt) {
  const ports = await pickPorts();
  const name = `repodna-neo4j-idem-${process.pid}-${randomBytes(3).toString('hex')}`;
  const password = `N4${randomBytes(16).toString('hex')}bB`;
  log(`attempt ${attempt}: starting ${NEO4J_IMAGE} as ${name} (http :${ports.http} bolt :${ports.bolt})`);
  try {
    dockerOut([
      'run', '-d',
      '--name', name,
      '-e', `NEO4J_AUTH=neo4j/${password}`,
      '-e', 'NEO4J_server_memory_heap_max__size=512M',
      '-e', 'NEO4J_server_memory_pagecache_size=256M',
      '-p', `127.0.0.1:${ports.http}:7474`,
      '-p', `127.0.0.1:${ports.bolt}:7687`,
      NEO4J_IMAGE,
    ]);
  } catch (error) {
    const messageText = String((error?.stderr ?? '') + (error?.message ?? ''));
    if (/address already in use|port is already allocated/i.test(messageText)) {
      log('host port race detected; retrying with fresh random ports');
      return null;
    }
    throw new Error(`docker run failed: ${messageText.slice(-LOG_TAIL_CHARS)}`);
  }
  containerName = name;
  currentPassword = password;
  return ports;
}

async function waitUntilReady(ports) {
  const deadline = Date.now() + READY_CAP_MS;
  const url = `http://127.0.0.1:${ports.http}/`;
  let httpLogged = false;
  while (Date.now() < deadline) {
    const status = await httpStatus(url);
    if (status === 200 && !httpLogged) {
      httpLogged = true;
      log('HTTP API responding (200); waiting for bolt/auth readiness...');
    }
    if (status === 200) {
      try {
        runQuery('RETURN 1 AS ok;');
        return true;
      } catch {
        /* bolt not accepting authenticated sessions yet */
      }
    }
    await sleep(1500);
  }
  return false;
}

function importCypherOnce(runIndex) {
  const startedImport = Date.now();
  dockerOut(['cp', CYPHER_PATH, `${containerName}:/tmp/cypher.txt`]);
  cypherShell(['--format', 'plain', '-f', '/tmp/cypher.txt']);
  log(`import #${runIndex} finished in ${((Date.now() - startedImport) / 1000).toFixed(1)}s`);
}

/*
 * Count queries. Label/type constants mirror app/lib/export/graph/cypher.ts:
 *   RepoDNAEntity / RepoDNAGroup / RepoDNAUnresolved node labels,
 *   MEMBER_OF membership relationship type.
 * Note on semantics:
 *   - manifest.counts.relationships covers document.relationships
 *     (resolved + synthetic-unresolved), but NOT memberships; therefore the
 *     total relationship expectation is counts.relationships + counts.groupMemberships.
 */
function collectCounts(sidecar) {
  const snapshot = {
    RepoDNAEntity: countOf('MATCH (n:RepoDNAEntity) RETURN count(n);'),
    RepoDNAGroup: countOf('MATCH (n:RepoDNAGroup) RETURN count(n);'),
    RepoDNAUnresolved: countOf('MATCH (n:RepoDNAUnresolved) RETURN count(n);'),
    allRelationships: countOf('MATCH ()-[r]->() RETURN count(r);'),
    memberOfRelationships: countOf(
      'MATCH (:RepoDNAEntity)-[r:MEMBER_OF]->(:RepoDNAGroup) RETURN count(r);',
    ),
    hostileNamedEntities: countOf(
      "MATCH (n:RepoDNAEntity) WHERE n.name CONTAINS 'DETACH DELETE' RETURN count(n);",
    ),
    foreignRelationships: countOf(
      "MATCH ()-[r]->() WHERE type(r) <> 'MEMBER_OF' AND r.syntheticTarget IS NULL RETURN count(r);",
    ),
    constraintsFound: [],
  };
  const showOutput = runQuery('SHOW CONSTRAINTS YIELD name RETURN name;');
  snapshot.constraintsFound = [...showOutput.matchAll(/repo_dna_[a-z]+_id/g)].map((m) => m[0]);
  void sidecar; // comparison happens in main(); parameter kept for symmetry
  return snapshot;
}

function logCounts(stage, snapshot) {
  log(
    stage,
    JSON.stringify({
      RepoDNAEntity: snapshot.RepoDNAEntity,
      RepoDNAGroup: snapshot.RepoDNAGroup,
      RepoDNAUnresolved: snapshot.RepoDNAUnresolved,
      allRelationships: snapshot.allRelationships,
      memberOfRelationships: snapshot.memberOfRelationships,
      constraints: [...snapshot.constraintsFound].sort(),
    }),
  );
}

function dumpDiagnostics() {
  if (containerName === '') return;
  try {
    const logs = dockerOut(['logs', '--tail', '80', containerName]);
    console.error(`---- docker logs (${containerName}) ----`);
    console.error(logs.slice(-LOG_TAIL_CHARS));
  } catch {
    /* diagnostics are best-effort */
  }
}

async function main() {
  startedAtMs = Date.now();

  /* Step 1 — Docker availability gate (SKIP path, exit 0). */
  const dockerVersion = detectDocker();
  if (dockerVersion === null) {
    console.log('[SKIP] Docker daemon unavailable in this environment.');
    console.log('[SKIP] Neo4j double-import verification is environment-gated.');
    console.log('[SKIP] Static fixture assertions still run everywhere via vitest.');
    process.exitCode = 0;
    return;
  }
  log(`docker OK (${dockerVersion})`);

  /* Step 2 — Fresh, integrity-checked fixtures from the real exporter. */
  regenerateFixturesViaVitest();
  const sidecar = JSON.parse(readFileSync(COUNTS_PATH, 'utf8'));
  const cypherOnDisk = readFileSync(CYPHER_PATH, 'utf8');
  const actualSha = createHash('sha256').update(cypherOnDisk, 'utf8').digest('hex');
  if (actualSha !== sidecar.cypherSha256 || statSync(CYPHER_PATH).size !== sidecar.byteSize) {
    throw new Error(`artifact/sidecar mismatch: sha256=${actualSha} expected=${sidecar.cypherSha256}`);
  }
  log(`fixtures verified: ${sidecar.filename} (${sidecar.byteSize} bytes, sha256 ok)`);

  /* Step 3 — Boot neo4j:5-community (random ports/name/password, retry on races). */
  let ports = null;
  for (let attempt = 1; attempt <= 3 && ports === null; attempt++) {
    ports = await bootContainer(attempt);
    if (ports === null && attempt >= 3) throw new Error('could not bind random ports after 3 attempts');
    if (ports === null) await sleep(2000);
  }

  try {
    /* Step 4 — Readiness within cap. */
    if (!(await waitUntilReady(ports))) {
      throw new Error(`neo4j not ready within ${READY_CAP_MS / 1000}s`);
    }
    log('neo4j ready');

    /* Step 5 — Import twice, snapshot counts between/after. */
    importCypherOnce(1);
    const afterFirst = collectCounts(sidecar);
    logCounts('after import #1', afterFirst);

    importCypherOnce(2);
    const afterSecond = collectCounts(sidecar);
    logCounts('after import #2', afterSecond);

    /* Step 6 — Idempotency: second import changed NOTHING. */
    const problems = [];
    for (const key of Object.keys(afterFirst)) {
      if (key === 'constraintsFound') continue;
      if (afterFirst[key] !== afterSecond[key]) {
        problems.push(
          `NOT IDEMPOTENT: ${key} went ${afterFirst[key]} -> ${afterSecond[key]} on re-import`,
        );
      }
    }

    /* Step 7 — Equality with the export manifest / sidecar. */
    const expected = sidecar.neo4jExpected;
    const comparisons = {
      RepoDNAEntity: expected.RepoDNAEntity,
      RepoDNAGroup: expected.RepoDNAGroup,
      RepoDNAUnresolved: expected.RepoDNAUnresolved,
      allRelationships: expected.allRelationships,
      memberOfRelationships: expected.memberOfRelationships,
    };
    for (const [key, want] of Object.entries(comparisons)) {
      if (afterSecond[key] !== want) {
        problems.push(`COUNT MISMATCH: ${key} imported=${afterSecond[key]} expected=${want}`);
      }
    }
    for (const constraint of expected.namedConstraints) {
      if (!afterSecond.constraintsFound.includes(constraint)) {
        problems.push(`MISSING CONSTRAINT: ${constraint} absent from SHOW CONSTRAINTS`);
      }
    }

    /* Step 8 — Injection evidence probes. */
    if (afterSecond.hostileNamedEntities !== expected.injectionProbeHostileNamedEntities) {
      problems.push(
        `INJECTION EVIDENCE: wanted exactly ${expected.injectionProbeHostileNamedEntities} entity holding the hostile payload as DATA, found ${afterSecond.hostileNamedEntities}`,
      );
    }
    if (afterSecond.foreignRelationships !== 0) {
      problems.push(
        `FOREIGN WRITES: ${afterSecond.foreignRelationships} non-membership relationship(s) lack exporter provenance (syntheticTarget flag)`,
      );
    }

    if (problems.length > 0) {
      dumpDiagnostics();
      for (const problem of problems) die(problem);
      throw new Error(`${problems.length} verification problem(s)`);
    }

    log('IDEMPOTENCY VERIFIED: re-import grew nothing; counts equal the export manifest;');
    log('all 3 constraints present; hostile payloads stored strictly as escaped DATA.');
    log(`DONE in ${elapsed()} — exit 0`);
  } catch (error) {
    dumpDiagnostics();
    throw error;
  } finally {
    teardown('finally');
    // Artifacts belong to this harness run; never leave residue behind.
    rmSync(GENERATED_DIR, { recursive: true, force: true });
  }
}

main()
  .catch((error) => {
    die(error?.stack ?? String(error));
    teardown('error-path');
    process.exitCode = 1;
  })
  .then(() => {
    if (!tornDown) teardown('end');
  });
