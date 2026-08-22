# ADR 001: Static-Only Deterministic Codebase Analysis

## Status
Accepted

## Context
Codebase visualizers typically either execute runtime tests/profilers to observe memory and network calls, or use external LLMs to guess architecture from file lists. Both approaches have significant flaws:
- Runtime execution of arbitrary repositories exposes the system to malicious scripts, package bombs, and environment inconsistencies.
- LLM guesswork is non-deterministic, hallucinates nonexistent relationships, cannot guarantee privacy for proprietary repositories, and is expensive at scale.

## Decision
RepoDNA operates **strictly as a deterministic static-analysis engine**. Source code is parsed purely as syntax trees and tokens, mapping AST structures to architectural layers, execution routes, and dependency call graphs without code execution.

## Consequences
- **Positive**: 100% immune to malicious code execution. Fully deterministic results across runs. Runs offline in-browser without server dependencies.
- **Negative**: Dynamic reflection, dynamic string imports, and runtime metaprogramming are inferred with heuristic confidence rather than runtime tracing.
