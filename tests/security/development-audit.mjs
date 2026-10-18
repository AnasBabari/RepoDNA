import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export function validateDevelopmentAudit(audit, mitigation, lock, now = Date.now()) {
  if (!audit.vulnerabilities || audit.error) throw new Error('Audit unavailable or malformed');
  const findings = Object.entries(audit.vulnerabilities);
  if (!findings.length) return 0;
  if (!mitigation.owner || now >= Date.parse(mitigation.expiresAt) || !Number.isFinite(Date.parse(mitigation.expiresAt))) throw new Error('Development mitigation expired or missing owner');
  for (const [name, entry] of findings) {
    if (!mitigation.packages.includes(name) || entry.severity === 'critical') throw new Error(`Unexpected advisory package: ${name}`);
    if (!entry.nodes?.length || entry.nodes.some((node) => lock.packages[node]?.dev !== true)) throw new Error(`Not exclusively development-only: ${name}`);
    if (!entry.via?.length || entry.via.some((via) => typeof via === 'string' ? !mitigation.packages.includes(via) : via.url !== mitigation.advisory || via.name !== 'braces')) throw new Error(`Unexpected advisory chain: ${name}`);
  }
  return findings.length;
}

export function verifyDevelopmentReachability(root) {
  const json = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
  if (json('package.json').scripts.dev !== 'vinext dev --host 127.0.0.1') throw new Error('Default development server must remain loopback-only');
  const deployment = json('vercel.json');
  if (deployment.framework !== 'nextjs' || deployment.buildCommand !== 'npm run build:vercel') throw new Error('Production runtime changed: reassess dev dependency reachability');
  function visit(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) visit(file);
      else if (item.isFile() && /\.[jt]sx?$/.test(item.name) && /(?:from\s*|import\s*\(|require\s*\()\s*['"](?:braces|micromatch|fast-glob|vinext|next\/og|@vercel\/og)(?:\/[^'"]*)?['"]/.test(readFileSync(file, 'utf8'))) throw new Error(`Runtime tooling import requires reassessment: ${path.relative(root, file)}`);
    }
  }
  visit(path.join(root, 'app'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const mitigation = JSON.parse(readFileSync(new URL('./development-mitigation.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  let output;
  const args = ['audit', '--json'];
  try { output = execFileSync(process.platform === 'win32' ? process.execPath : 'npm', process.platform === 'win32' ? [process.env.npm_execpath, ...args] : args, { cwd: root, encoding: 'utf8', timeout: 60_000 }); }
  catch (error) { if (error.status !== 1 || !error.stdout) throw error; output = error.stdout; }
  const audit = JSON.parse(output);
  verifyDevelopmentReachability(root);
  const count = validateDevelopmentAudit(audit, mitigation, lock);
  console.log(JSON.stringify({ developmentAffectedPackages: count, auditCounts: audit.metadata.vulnerabilities, mitigationOwner: mitigation.owner, expiresAt: mitigation.expiresAt, advisory: mitigation.advisory }));
  console.log('Not a clean full tree: known development-only risk is temporarily contained, never suppressed from the production gate.');
}
