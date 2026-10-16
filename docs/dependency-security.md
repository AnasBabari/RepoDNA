# Dependency-security review (16 October 2026)

Tracking: [issue #1](https://github.com/AnasBabari/RepoDNA/issues/1).
Owner: AnasBabari / RepoDNA maintainer.

## Production dependency tree

The baseline production audit reported 24 affected packages: two critical,
seven high, fourteen moderate, one low. These are dependency-chain counts,
not 24 independently demonstrated application exploits.

The local patch upgrades Next.js 16.3.2 to 16.3.8 (and matching ESLint config),
Workflow 4.8.5 to 4.8.13, and compatible affected transitive dependencies.
Workflow's explicit Undici overrides now use 7.30.1, not vulnerable 7.29.0.
Workflow 4.8.13 still pins devalue 5.9.2, so its existing scoped override now
also selects the compatible 5.9.4 security patch. Keep that override until
upstream ships an equivalent fix; do not migrate Workflow to v5 just to clear
the audit. npm audit fix was used without --force.

After a clean npm ci, npm run audit:production reports zero vulnerabilities.
CI now runs this command and fails on high/critical production findings;
there is no advisory allowlist and no suppressed production finding.
The patched deployment is not yet verified: review, push and Vercel deployment
are a separate release checkpoint. A passing local audit does not repair the
already-deployed application.

## Reachability assessment

- [Next.js next/og advisory](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j):
  the affected path requires attacker-controlled SVG content passed to the
  Node ImageResponse renderer. No such app route was identified in this review.
  This is not an exemption: the dependency is patched regardless. Other Next
  image/cache/development-route advisories also require the newer patch.
- [proxy-addr trust-subnet advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h):
  a vulnerable transitive package was present; a configured attacker-reachable
  Express trust-proxy path was not demonstrated. The resolved package is now
  patched instead of assuming this cannot become reachable.
- Workflow serialization and HTTP clients are used by public server workflows.
  These are treated as relevant production dependencies, not waved away as
  unused framework integrations. Their vulnerable dependencies are patched.
- The Blob SDK accepts a Node Buffer upload body. The server export cache now
  provides an exact zero-copy view of its Uint8Array's byte range, without
  changing export content, digest, privacy or storage policy.

No live exploit was attempted or demonstrated.

## Remaining development-tool findings

The full npm audit (including devDependencies) still reports 11 affected
packages: eight high and three moderate, zero critical. Do not describe this
as a completely clean dependency tree.

- braces is affected across all published versions by
  [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
  Its micromatch / fast-glob chains affect ESLint and Vinext build tooling.
  npm proposes incompatible framework/tool downgrades, not a safe braces patch.
- satori's fflate 0.7.x dependency propagates a moderate advisory through
  @vercel/og and Vinext. RepoDNA's source-archive parser uses the separate,
  patched direct fflate 0.8.3 dependency. No Vinext image-generation endpoint
  processing attacker-supplied ZIP data was demonstrated.

These tools are outside npm's production dependency tree but are executed
during development/builds. Keep developer servers local, treat untrusted build
inputs as a risk, monitor upstream fixes, and rerun the full audit before
upgrading. The owner must reassess any new reachability or plan to deploy
Vinext as the production runtime. This review does not establish a permanent
risk acceptance and does not disable any security checks.

## Verification commands

    npm ci
    npm run audit:production
    npm audit
    npm run lint
    npm run typecheck
    npm run test:unit
    npm run test:python
    npm run build
    npm run build:vercel
    npm run test:e2e

The typecheck script now regenerates compatible Next route types before strict
tsc validation (#20). Both mixed-builder orders passed locally and are exercised
by CI. Run builds serially, not concurrently. Do not delete source files or skip
type checking to hide a failure.
