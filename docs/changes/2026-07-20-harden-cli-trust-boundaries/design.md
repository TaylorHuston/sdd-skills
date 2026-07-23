# Design: Harden CLI Trust Boundaries

## Context

The CLI is an ESM Node package with central configuration/workspace resolution, shared filesystem helpers, command modules, checked JSON schemas, and Node-native tests. The audit confirmed ten findings against the current dirty `develop` snapshot. Several are the same root problem expressed at different layers: the CLI sometimes treats a lexical path or the presence of a Markdown row/file as proof of a stronger physical or semantic invariant.

## Goals / Non-Goals

**Goals:**

- Make successful v2 Epic validation require navigable behavior, implementation, and verification evidence.
- Keep every managed mutation and accepted evidence path within its physical owner boundary.
- Detect overlapping writers and preserve or clearly report recoverable state.
- Centralize topology/configuration invariants so commands cannot invent or ambiguously resolve ownership.
- Bound diagnostics and prevent obvious false-positive guidance failures.
- Add focused tests that falsify each audit claim against the actual boundary.

**Non-Goals:**

- Replace the Markdown SDD artifact model.
- Add a hosted coordinator, daemon, database, or external lock service.
- Interpret arbitrary natural-language guidance.
- Guarantee cooperation from editors or processes that ignore operation locks; commands must still compare the commit-time state and fail safely.
- Rewrite the entire CLI or test suite solely to reduce line counts.

## Planning Interview / Story Refinement

- Scope boundary reviewed: all validated audit findings are included; broad unrelated workflow prose changes are not.
- User decisions: apply the audit fixes; preserve adaptive implementation rather than predicting every file change.
- Assumptions: filesystem and CLI semantics must remain portable across supported Node 20+ environments.
- Deferred scope: non-behavioral module cleanup not needed to make the touched guarantees inspectable.
- Story boundaries challenged: validation, mutation, topology, and diagnostics are separate developer workflows and remain separate Stories.
- Requirements refined: every audit finding maps to an observable rejection, bounded completion, or recovery result.
- Scenario gaps considered: empty/fabricated evidence, symlink ancestors, concurrent modification, partial rollback, repository-only context, physical aliases, artifact overlap, unknown keys, lifecycle collision, negated guidance, and hung Git.
- Open questions that block implementation: none.

## Epic Changes

### Create Epic: SDD-E001 Reliable CLI Operations

- Proposed directory: `docs/epics/sdd-e001-reliable-cli-operations/`
- Proposed file: `docs/epics/sdd-e001-reliable-cli-operations/epic.md`

The Epic records the CLI behaviors developers and agents rely on when validating truth, mutating SDD state, resolving topology, and diagnosing a workspace.

## Technical Options

### Option 1: Targeted checks inside each command

- Summary: patch each audited condition at its current call site.
- Implementation complexity: initially low, but duplicates physical-path, evidence, topology, and recovery rules.
- Reversibility: high.
- Testability: individual cases are easy; cross-command consistency is difficult.
- Operational risk: future commands can bypass one of the duplicated checks.
- Fit with project conventions: weaker than the existing shared `fs.js`, `config.js`, and workspace helper model.

### Option 2: Shared invariant helpers with command-level commit checks

- Summary: centralize physical containment, strict configuration shape/relationships, and evidence parsing while keeping command-specific orchestration and recovery local.
- Implementation complexity: moderate.
- Reversibility: high; helpers remain package-local.
- Testability: shared unit fixtures plus command-level adversarial tests.
- Operational risk: requires careful compatibility tests for configured roots and nested closed Changes.
- Fit with project conventions: strong; extends existing shared modules without adding infrastructure.

### Option 3: New schema/transaction dependencies

- Summary: add a general JSON Schema runtime and third-party filesystem transaction/locking layer.
- Implementation complexity: high and adds package/runtime surface.
- Reversibility: moderate.
- Testability: good but dependency behavior becomes part of the contract.
- Operational risk: version and cross-platform semantics exceed the immediate need.
- Fit with project conventions: unnecessary for the current narrow package.

## Selected Approach

Use shared package-local invariant helpers and command-level atomic commit checks. Physical containment resolves existing ancestors with `realpath` and is rechecked immediately before destructive or replacing operations. Configuration validation strictly enforces the checked shapes and central relationship rules without a new dependency. Lifecycle commands compare the state captured at commit time, preserve recovery artifacts until success, and surface rollback failures. Validator evidence parsing distinguishes a path from its required searchable anchor and counts coverage only after the row and proof pass structural checks. Diagnostics remain deterministic: guidance detection recognizes only affirmative obsolete instructions, and Git status has a bounded timeout with degraded per-repository output.

## Client And API Boundary

- Current clients: human shell users and agent runtimes consuming human or JSON CLI output.
- Plausible future clients: local Dashboard/plugin surfaces that invoke the CLI as a deterministic core.
- Reusable product capabilities: context resolution, artifact validation, lifecycle mutation, installation sync, and status/doctor diagnostics.
- API or typed contract: existing exported JavaScript functions and JSON command result/error shapes.
- OpenAPI plan, if HTTP-facing: not applicable.
- Backend platform exposed directly to clients?: no.
- Client-specific presentation or local state: human formatting stays in the CLI; command functions return structured results.
- Rationale: preserve a local-first deterministic core that alternate clients can call without inheriting shell prose parsing.

## Alternatives Considered

- Add AJV or another schema runtime now:
  - Why not: strict shape and relationship parity can be achieved within the current small configuration surface without expanding dependencies; reconsider if schema complexity grows.
- Treat symlinked roots as supported transparent aliases:
  - Why not: mutation boundaries would then depend on user intent that the persisted config cannot express safely. Existing root paths may themselves resolve through symlinks, but child mutation/evidence paths must remain physically under the resolved owner root.
- Use a long-lived daemon lock:
  - Why not: same-directory atomic operations, short-lived operation locks, and commit-time compare-and-set checks fit the local CLI model.

## Why This Approach

It fixes the audited behavior at the lowest durable shared boundaries, adds no external service or dependency, and keeps compatibility decisions visible in focused tests. It also supports future Dashboard/plugin clients by improving structured command guarantees instead of hiding recovery semantics in interactive prose.

## ADRs

- Required: no.
- ADR path: not applicable.
- Decision summary: tighten existing documented CLI invariants with shared helpers.
- Reconsider when: SDD needs cross-machine coordination, long-running transactions, or schemas complex enough that manual/runtime parity is no longer maintainable.

## Implementation Constraints

- Preserve unrelated dirty files and current uncommitted workflow/template work.
- Work directly on `develop` per repository policy.
- Do not commit without separate user authorization under repository-local policy; keep coherent commit candidates and report the immutable-handoff blocker honestly.
- Preserve Node 20+ support and machine-readable JSON behavior.
- No UI or manual UI confirmation is required.
- New hardening logic must live in bounded helpers or focused test modules instead of further concentrating `src/cli.js`, `src/commands/validate.js`, or `test/cli.test.js` without reason.

## Verification Strategy

- Focused automated tests: Node tests for every Requirement and Scenario, including temporary filesystem/symlink fixtures, fabricated Markdown evidence, command collisions, concurrency drift, rollback injection, negated guidance, and a fake hung Git executable.
- Broad supporting gates: `npm run check`, native coverage, `git diff --check`, `npm pack --dry-run --json`, package skill validation, and scoped `sdd validate`.
- Deterministic E2E: CLI subprocess tests for repository-only create rejection and structured timeout/degraded results.
- Live-provider or external-service playtests: not applicable.
- Manual UI confirmation: not applicable; CLI-only behavior.
- Debug/log inspection: inspect structured error codes/details and exact post-failure filesystem state.

## Decisions

- The current code audit is evidence input, not implementation truth; final Epic maps will point to exact helpers and tests.
- Repository-only context supports repository-local operations but refuses idea-owned planning operations until mapped.
- The one permitted Change-root overlap is a direct-child closed-history directory such as `docs/changes/closed`.
- Exact searchable anchors use a path-plus-`#anchor` form in v2 implementation and automated-test evidence.

## Risks / Trade-Offs

- Realpath checks can reveal previously tolerated symlink layouts; errors must identify the configured path and physical boundary clearly.
- Stricter v2 evidence validation can invalidate existing weak artifacts; legacy compatibility remains separate, and release notes must explain the new contract.
- Failure injection can become brittle if it asserts implementation details instead of final state and error semantics.
- A short race remains possible with non-cooperating external editors; commit-time state comparison and retained recovery data minimize silent loss.
