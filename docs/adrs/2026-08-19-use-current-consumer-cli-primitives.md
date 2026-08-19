# ADR: Use Current-Consumer CLI Primitives

- Status: Accepted
- Date: 2026-08-19
- Related Change ID: `2026-08-17-replace-default-sdd-workflow`
- Related Epics / Stories: `SDD-E001/S2`, `SDD-E001/S3`, `SDD-E001/S6`

## Context

The SDD workflow is an owner-operated pre-1.0 local tool, but most of its current executable and test surface descends from an unreleased workspace-migration implementation that treated unsupported alpha state as a transactional migration problem. That implementation added staged directory publication, multi-step rollback, source retirement, crash recovery, symlink-race handling, and independently bound recovery provenance.

The dedicated alpha-migration modules were removed immediately afterward, but their generalized filesystem and directory-publication infrastructure remained and now supports ordinary current commands. At the current package candidate, the CLI contains about 26,700 runtime lines and 17,300 test lines. Roughly 70% of committed runtime lines and 75% of committed test lines originate in the workspace-migration commit. Two unchanged migration-born modules, `src/fs.js` and `src/directory-publication.js`, account for about 39% of runtime; the directory-publication module has one current production consumer.

The existing safety goals remain valid: physical owner confinement, no silent overwrite of concurrent work, parseable durable files, explicit authority, and actionable failure reporting. The decision is whether to preserve the current generalized recovery architecture, replace it incrementally around current consumers, or rebuild the current CLI contract from a small clean implementation.

## Decision

Simplify incrementally around current command consumers. Do not perform a clean-room rewrite and do not preserve migration-born abstractions merely because historical tests or Epic maps cite them.

Use operation-specific primitives with this bounded recovery contract:

1. Resolve lexical and physical ownership before mutation and recheck the affected boundary immediately before commit.
2. Never silently overwrite content that differs from the prepared state.
3. Use atomic replacement for individual durable files so configuration and lock files remain complete and parseable.
4. Use exclusive no-replace creation for new directories and preserve any unexpected target or partial residue for inspection.
5. Serialize the small number of current managed-installation and first-initialization operations that require one writer.
6. On interruption, cleanup failure, or unexpected concurrent replacement, stop with a typed error that identifies preserved state and the required manual recovery action.
7. Do not promise automatic replay, authenticated crash recovery, arbitrary partial-cleanup continuation, cross-artifact rollback to a prior global state, or migration of unsupported pre-1.0 installations.

Replace one current command boundary at a time, prove its observable contract, then delete the superseded generic implementation and tests once no current consumer remains. Preserve external command names, JSON contracts, workspace ownership, physical confinement, Change compare-and-set behavior, and candidate integrity unless a separately accepted Requirement revision says otherwise.

Use a material reduction target as a guardrail rather than a deletion oracle. Reduce runtime and test lines by at least 50% before Change closeout, with no outcome allowed to introduce another generalized transaction or compatibility framework without a demonstrated current consumer.

## Options Considered

### Option 1: Incremental Current-Consumer Replacement

- Summary: Inventory current consumers, replace migration-born abstractions with small operation-specific primitives, and delete each old seam after focused parity proof.
- Pros: Preserves working command boundaries; isolates risk; supports small reviewed outcomes; exploits the fact that complexity is concentrated in a few modules; allows accepted recovery guarantees to narrow explicitly.
- Cons: Temporary overlap is unavoidable; incremental work can leave abstraction residue if deletion is not an outcome requirement; total reduction is less predictable than a rewrite.
- Current disposition: Selected.

### Option 2: Clean-Room Current-Contract CLI

- Summary: Reimplement only the current setup, context, status, validation, lifecycle, candidate, and managed-skill commands, then cut over after parity review.
- Pros: Strongest opportunity for a small coherent architecture; avoids inheriting migration-era structure; makes the current contract explicit.
- Cons: Requires broad command and output parity at cutover; duplicates implementation temporarily; encourages another large candidate; risks reproducing the existing overengineering while chasing parity; conflicts with one-fresh-session outcome sizing.
- Current disposition: Viable but not recommended unless incremental replacement cannot remove the concentrated infrastructure.

### Option 3: Preserve Runtime And Only Reduce Workflow/Test Ceremony

- Summary: Keep the current filesystem/publication architecture and trim prose, fixtures, and broad test execution.
- Pros: Lowest immediate implementation risk; retains all existing recovery claims.
- Cons: Leaves the main maintenance and change-amplification source intact; historical guarantees continue to dictate architecture; small changes remain expensive; test deletion without contract simplification would reduce confidence rather than complexity.
- Current disposition: Rejected.

## Consequences

- Positive: Current safety boundaries remain explicit while unsupported migration and generalized recovery cease driving the architecture.
- Positive: Work can be delivered in bounded command-oriented outcomes rather than one rewrite candidate.
- Positive: Tests can follow current observable guarantees instead of preserving every historical failure injection.
- Positive: Epic implementation and verification maps become smaller and more navigable as superseded anchors are removed.
- Negative: Some unexpected interruptions will require manual recovery rather than automatic rollback or replay.
- Negative: The package may temporarily carry old and new primitives during an outcome, although each accepted outcome must remove the superseded seam before completion.
- Negative: Narrowing `SDD-E001/S2 R3` is an accepted behavior change and requires explicit Epic reconciliation and release communication when eventually released.
- Follow-up: `/sdd-change` must convert this decision into bounded outcomes only after acceptance; it must keep the already reviewed Resume correction separate.

## Validation

Implementation and Review must prove:

- every retained primitive has a named current command consumer;
- `SDD-E001/S2 R1`, R2, and R4 physical-confinement, concurrent-drift, workspace-ownership, and no-home-mutation Scenarios remain passing;
- revised `SDD-E001/S2 R3` states the bounded manual-recovery contract honestly and has focused failure-injection proof at that boundary;
- affected `SDD-E001/S3` creation, configuration, identity, transition, close, and discovery Scenarios retain their current observable behavior;
- setup, update, init, Epic creation, Change creation/transition/close, validation, status, context, and candidate resolution retain their documented human and JSON contracts where touched;
- removed migration/replay/publication guarantees have no current production consumer and no contradictory current documentation or Epic claim;
- each outcome records before/after runtime lines, test lines, focused test duration, and changed authority surfaces;
- final runtime and tests each fall by at least 50% from the accepted pre-cleanup baseline, or the owner explicitly revises the target based on the current-consumer inventory;
- focused command tests, syntax/diff checks, scoped SDD validation, package inventory, and a disposable current-workspace smoke test pass; broad historical migration suites are not recreated.

## Reconsider When

Reconsider this decision if:

- a stable external release creates a real compatibility obligation for automatic migration or crash replay;
- concurrent multi-process mutation becomes an ordinary supported operating mode rather than a defensive edge;
- current consumers demonstrate that manual recovery cannot protect user data adequately;
- incremental replacement cannot remove at least half of the current runtime and test surface without repeated cross-cutting candidates;
- a hosted or multi-user SDD service requires transactional state beyond local Git and workspace files.
