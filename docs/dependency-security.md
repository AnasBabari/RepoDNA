# Dependency-security review (18 October 2026)

Tracking: [issue #1](https://github.com/AnasBabari/RepoDNA/issues/1) and
[issue #21](https://github.com/AnasBabari/RepoDNA/issues/21).
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

The full audit originally reported 11 affected packages. The scoped Satori
fflate override now installs compatible 0.7.5 instead of 0.7.3, removing three
moderate transitive findings. A clean `npm ci` leaves eight high affected
development packages, zero moderate/critical; production remains zero findings.
These eight packages share one underlying braces advisory, not eight proven
application exploits. Do not describe the full dependency tree as clean.

- braces is affected across all published versions by
  [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
  Its micromatch / fast-glob chains affect ESLint and Vinext build tooling.
  npm proposes incompatible framework/tool downgrades, not a safe braces patch.
- [The fflate advisory](https://github.com/advisories/GHSA-px8p-9vwx-vf98)
  explicitly lists 0.7.5 and 0.8.3 as patched. Satori retains its 0.7 API line;
  RepoDNA's source-archive parser retains direct fflate 0.8.3. No framework
  downgrade or `audit fix --force` was used.

### Temporary mitigation: owner AnasBabari; expires 25 October 2026, 00:00 UTC

The braces advisory lists no patched version; registry latest remains 3.0.3.
`npm explain braces` reproduces both chains:

- eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces.
- vinext → vite-plugin-commonjs → vite-plugin-dynamic-import → fast-glob →
  micromatch → braces.

These tools process checked-out project/configuration and run during builds.
Only reviewed project source/config/glob patterns may be built; never install,
build, lint or execute a repository submitted for analysis. Acquired repositories
remain parser input strings. Do not copy their package manifests/configuration
into this project's build tree. Review dependency/script changes before running
them; CI PR jobs receive no production secrets. This is containment, not proof
that tooling can safely process malicious patterns or an exploit-free verdict.

`npm run dev` now explicitly binds 127.0.0.1. Do not override it with 0.0.0.0 or
expose it via a tunnel while this mitigation is in force. Vercel still selects
Next.js/build:vercel, not a Vinext runtime. `npm run audit:development` checks
the full audit, every affected lock entry's dev-only classification, one known
advisory chain, owner and expiry. New findings, critical escalation, moving an
affected package to production, application imports of the tooling/OG renderer,
or a changed deployment runtime fail closed and require reassessment.

The guard is deliberately not a proof against computed imports, unreviewed build
scripts or hostile filenames; maintainer review of build inputs remains mandatory.
Re-run `npm audit`, `npm explain braces`, and the guard on any tooling change.
Before expiry the owner must install a published compatible patch/remove the
affected toolchain, or explicitly review fresh evidence and a new finite window.
CI automatically fails when this window expires; it does not renew itself.
The independent high/critical production gate is unchanged and has no exceptions.

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
