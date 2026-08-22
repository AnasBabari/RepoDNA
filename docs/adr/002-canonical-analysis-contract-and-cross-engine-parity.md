# ADR 002: Canonical Analysis Contract & Cross-Engine Parity

## Status
Accepted

## Context
RepoDNA provides two analysis execution environments:
1. Python core engine (`core/repodna`) used for local CLI workflows and benchmark validation.
2. TypeScript engine (`app/lib/analyzer`) used for serverless Vercel API and 100% in-browser client analysis.

Without a strict, canonical data contract, features implemented in one engine could diverge from the other, yielding inconsistent architecture maps depending on whether the analysis was processed on the server or in the browser.

## Decision
1. Establish a single formal JSON Schema (`schema/repodna.schema.json`, schemaVersion: `1.1.0`) specifying all fields in standard camelCase.
2. Implement schema validators in both TypeScript (`validateRepoDNAProject`) and Python (`validate_analysis_result`).
3. Maintain a cross-engine conformance test suite in CI (`tests/unit/parity.test.ts`, `tests/test_parity.py`) running against standardized multi-language fixtures.

## Consequences
- **Positive**: Complete structural consistency regardless of execution mode. CI prevents inadvertent divergence between serverless and browser engines.
- **Negative**: Analyzer changes must update both implementations and pass the cross-engine parity suite.
