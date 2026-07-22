# Proposal: Harden CLI Trust Boundaries

## Why

The 2026-07-20 CLI code audit found that the package's happy-path coverage is strong while several validation, topology, filesystem, concurrency, and diagnostic boundaries can still return misleading success or mutate outside the user's intended scope. These gaps are especially costly because the CLI is the deterministic foundation that the SDD skills use to establish artifact truth.

## What Changes

- Make Epic validation reject structurally empty Stories and unverifiable implementation or test claims.
- Make filesystem containment physical rather than lexical and make mutation recovery explicit.
- Reject invented, ambiguous, overlapping, or schema-invalid topology before creating or moving artifacts.
- Make diagnostic commands bounded and precise enough that correct guidance and one stalled repository do not block the whole workflow.
- Add focused hardening tests in bounded test modules so the new guarantees remain easy to inspect.

## Target Repositories

- This repository.

## Epic Actions

### New Epic Directories

- `docs/epics/sdd-e001-reliable-cli-operations/epic.md`

### Existing Epic Directory Updates

- None.

## Epic Story Changes

- Add `SDD-E001/S1` for trustworthy structural and evidence validation.
- Add `SDD-E001/S2` for physically contained and recoverable filesystem mutation.
- Add `SDD-E001/S3` for unambiguous topology and Change routing.
- Add `SDD-E001/S4` for bounded, context-aware diagnostics.

## Scope Decisions

- Confirmed: all validated findings in `docs/audits/2026-07-20-code-audit.md` are implementation input.
- Confirmed: the current dirty `develop` worktree is the implementation baseline and must not be discarded or overwritten.
- Confirmed: no UI, hosted service, credentialed system, database, or production environment is involved.
- Deferred: broad aesthetic refactoring of every large CLI module. This Change must leave new rules in bounded helpers/tests and reduce concentration where it materially improves the touched behavior, without turning safety work into a rewrite.
- Assumptions: repository-only packages remain valid SDD participants for repository-local Epics, Changes, validation, and status, but they cannot invent a private Idea/planning relationship.
- User decisions that shaped the Story/Requirement split: the accepted audit findings define the desired end state; planning records confirmation obligations rather than a fixed file sequence.

## Change Folder

- Planned location: bootstrapped directly in the repository because the current repository-only `change create` path is itself a confirmed defect.
- Active location: `docs/changes/2026-07-20-harden-cli-trust-boundaries/`
- Closed location: `docs/changes/closed/2026-07-20-harden-cli-trust-boundaries/`

## Impact

- Product: CLI failures become safer and successful validation becomes more meaningful.
- Code: validation, filesystem, configuration, topology, lifecycle, status, and guidance modules.
- Tests: adversarial validator, symlink, concurrency/recovery, topology, collision, timeout, and guidance cases.
- Docs: README, canonical workflow, schemas, changelog, Epic, and Change ledgers must agree with final behavior.
- ADRs: not required; this tightens existing advertised boundaries rather than choosing a new product architecture.

## Release Communication Impact

- Required: yes.
- Record / section: `CHANGELOG.md` under Unreleased.
- Public summary: validation and mutation hardening for trustworthy Epic evidence, safe paths, topology, lifecycle, and diagnostics.

## Open Questions

- None. Implementation may refine exact helper boundaries and evidence syntax while preserving these observable outcomes.
