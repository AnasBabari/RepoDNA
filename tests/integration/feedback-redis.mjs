import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

// Local, disposable Redis only. No host ports, production URL, token or personal data.
const name = `repodna-feedback-test-${randomUUID()}`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000 }).trim();
const redis = (...args) => docker('exec', name, 'redis-cli', '--raw', ...args);
const source = readFileSync(new URL('../../app/lib/feedback-store.ts', import.meta.url), 'utf8');
const script = source.match(/export const FEEDBACK_SCRIPT = `([\s\S]+?)`;/)?.[1];
assert.ok(script);
let created = false;
try {
  docker('run', '--rm', '-d', '--name', name, 'redis:7-alpine');
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if (redis('PING') === 'PONG') { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Disposable Redis must become ready');
  const expiry = Math.floor(Date.now() / 86_400_000) * 86_400 + 30 * 86_400;
  const submit = (receipt) => redis('EVAL', script, '3', 'daily', receipt, 'rate', String(expiry), 'total', 'rating:4', 'usecase:architecture', 'capability:diagram_export');
  assert.equal(submit('receipt-1'), '1');
  assert.equal(submit('receipt-1'), '1');
  assert.equal(redis('HGET', 'daily', 'total'), '1', 'Retry must not count twice');
  assert.equal(submit('receipt-2'), '1');
  assert.equal(redis('HGET', 'daily', 'total'), '2');
  assert.equal(redis('HGET', 'daily', 'rating:4'), '2');
  assert.equal(redis('HLEN', 'daily'), '4', 'Only fixed aggregate fields retained');
  const ttl = Number(redis('TTL', 'daily'));
  assert.ok(ttl > 29 * 86_400 && ttl <= 30 * 86_400);
  assert.ok(Number(redis('TTL', 'receipt-1')) <= 86_400);
  assert.ok(Number(redis('TTL', 'rate')) > 0);
  redis('SET', 'rate', '120', 'EX', '60');
  assert.equal(submit('receipt-denied'), '0');
  assert.equal(redis('EXISTS', 'receipt-denied'), '0');
  assert.equal(redis('HGET', 'daily', 'total'), '2');
  console.log('PASS: actual Redis atomic retry deduplication, aggregate-only fields, daily expiry, receipt TTL and throttling');
} finally {
  if (created) docker('rm', '-f', name);
}
