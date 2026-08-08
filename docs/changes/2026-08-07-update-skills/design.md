# Design: Centralize Change Storage

## Context

Current SDD storage has three owners: idea planning roots own proposed/planned drafts, repositories own active copies, and repository `closed/` folders own history. `sdd change promote` copies one draft into each selected repository and rewrites it per destination. Transition, close, status, and validation then enumerate repository artifact roots. This conflicts with the desired invariant that one Change has one authoritative record.

## Goals / Non-Goals

**Goals:**

- Make `~/.sdd/changes` the only canonical Change store.
- Preserve Space ownership and multi-repository targeting without repository copies.
- Keep active lifecycle status in `tasks.md`; derive closed state from the central `closed/` location.
- Migrate compatible legacy records automatically and fail before mutation on ambiguity or divergence.
- Keep filesystem mutation confined, recoverable, deterministic, and machine-readable.
- Remove obsolete paths, configuration keys, commands, prose, templates, and tests in one clean cutover.

**Non-Goals:**

- Shared or hosted Change synchronization.
- Backing up or version-controlling `~/.sdd`.
- Moving Epics, ADRs, audits, implementation, tests, or release communication out of repositories.
- Preserving promotion aliases or dual-read compatibility after successful migration.

## Planning Interview / Story Refinement

- Scope boundary reviewed: this is a package-wide storage/lifecycle change, not a narrow skill wording update.
- User decisions: flat global IDs; automatic migration during `sdd update`.
- Assumptions: stable repository IDs identify targets; missing or conflicting identity fails closed.
- Deferred scope: shared stores, repository exports, backups, hosted coordination.
- Story boundaries challenged: lifecycle ownership remains S3; workflow execution/path semantics remain S6. No new Story is needed.
- Requirements refined: central ownership, global collision behavior, migration preflight/rollback, metadata targeting, and post-migration command behavior.
- Scenario gaps considered: duplicate IDs across Spaces, identical and divergent copies, destination collision, missing repositories, symlink escape, concurrent edits, failed commit/rollback, and rerun idempotence.
- Open questions that block implementation: none.

## Epic Changes

### Update Epic: SDD-E001 Reliable Toolchain Operations

- Target Epic: `docs/epics/sdd-e001-reliable-cli-operations/epic.md`
- Change Type: modified scope

#### Story Changes

- Modified `S3`: replace idea/repository Change ownership with one user-level store; add global ID, metadata ownership, migration, confinement, and collision Scenarios.
- Modified `S6`: replace planned-draft promotion and repository-local lifecycle paths with direct central planning/apply/review/closeout.
- Removed: no Story; obsolete Requirements or Scenarios are rewritten rather than left as competing truth.

#### Supersedes / Reconciles

- S3/R1 planning-mapping language that assumes planned Change ownership under an Idea path.
- S3/R2-S3 owner-relative `plannedChangesDirectory` behavior.
- S3/R3 repository active/closed collision behavior.
- S2 promotion and multi-repository mutation evidence where central single-record mutation changes the governing boundary.
- S6 planning/promotion/apply/closeout prose and evidence that cites repository-local Change folders.
- This bootstrap Change record moves from `docs/changes/` to the central store after the migration is proven.

## Technical Options

### Option 1: Space-Namespace, Status-Driven

- Summary: `~/.sdd/changes/<space-id>/<change-id>` with per-Space closed history.
- User impact: ownership is visible and collisions are isolated.
- Implementation complexity: moderate.
- Reversibility: straightforward path migration.
- Data / schema impact: Space path is implicit; repository targets still need metadata.
- Testability: strong.
- Operational risk: lower collision risk.
- Fit with project conventions: good, but declined by the user.

### Option 2: Lifecycle Directories

- Summary: central `planned`, `active`, and `closed` directories, optionally Space-namespaced.
- User impact: lifecycle remains visible in paths.
- Implementation complexity: higher because promotion/path churn remains.
- Reversibility: moderate.
- Data / schema impact: status and path duplicate lifecycle state.
- Testability: strong but larger transition matrix.
- Operational risk: duplicate state can drift.
- Fit with project conventions: preserves mechanics the user wants removed.

### Option 3: Flat Global IDs

- Summary: active Changes at `~/.sdd/changes/<change-id>` and closed history at `~/.sdd/changes/closed/<change-id>`.
- User impact: shortest stable path and one canonical record.
- Implementation complexity: moderate; ownership metadata and global collision enforcement are required.
- Reversibility: migration can reconstruct Space/repository ownership only while metadata remains valid.
- Data / schema impact: `tasks.md` frontmatter adds `space` and `repositories`; repository and user config drop Change-path keys.
- Testability: strong through temporary user homes and repositories.
- Operational risk: global ID collisions and unversioned user-local records.
- Fit with project conventions: selected by the user.

## Selected Approach

Add a shared central Change-store boundary used by every lifecycle command and inventory path. For a user installation rooted at the home directory, the active root is `<user-root>/.sdd/changes` and the closed root is its `closed` child. The active root contains only valid Change IDs plus reserved internal staging entries; the `closed` directory is excluded from active enumeration.

`tasks.md` frontmatter becomes:

```yaml
---
status: proposed
space: <space-id>
repositories:
  - <repository-id>
---
```

The path no longer encodes Space ownership, so every command validates `space` against its argument and resolves each repository ID through the user topology plus the repository's portable contract. Global Change-ID collisions across active and closed roots are hard errors.

`change create` writes the canonical central folder immediately. `change transition` mutates that one `tasks.md`. `change close` moves the folder to the central closed root. `change promote` is removed from the CLI and skills because there is no second location to promote into. Status and validation enumerate central records once, then project their target repository activity and validate referenced repository Epics/artifacts.

User configuration and repository configuration advance schema versions and remove `planning.plannedChangesDirectory`, `repositoryArtifacts.activeChanges`, and `repositoryArtifacts.closedChanges`. Repository artifacts continue to own Epics, ADRs, audits, implementation, tests, and supporting documentation. New setup/init writes only the new shapes.

Undated Change Briefs remain idea-owned at the fixed `<planning-path>/change-briefs/<slug>.md` path. They carry no Change status or central ownership metadata.

`sdd update` detects older supported user/repository schemas before strict current-shape validation. It preflights every configured Space planning root and mapped repository active/closed root, builds a complete migration plan, resolves ownership and repository IDs, hashes source directories, and detects global destination collisions. Before publication it persists a user-store-confined transaction journal that records source, destination, configuration, and physical-owner identities; a later update recovers an interrupted transaction under the same locks before replanning, while dry-run reports recovery as required without mutating state. Dated legacy directories become central Changes; undated legacy `.md` files move to the owning idea's fixed `change-briefs/` directory. Planned Changes recover the exact repositories selected by the old CLI from their recorded proposal paths; only a sole active repository may be inferred when that record is absent. Byte-identical Change copies consolidate with the union of repository IDs. Divergent copies, cross-Space ID reuse, malformed metadata, missing or ambiguous target identity, unavailable legacy source owners, unsafe symlink ancestry, or a mismatched Change/brief destination abort the update with no Change writes, brief writes, config upgrades, or source removals.

Legacy workspace configuration remains migration input, not an alternate live Change owner. Setup from a supported legacy workspace records a transient source locator in the user configuration; update locks and revalidates that source, and removes the locator only in the same successful transaction that publishes central records and retires legacy roots. Change commands otherwise resolve the user installation as authoritative; when legacy records remain, they return a migration-required diagnostic directing the user to `sdd update` instead of silently using two stores.

## Client And API Boundary

- Current clients: terminal users and agent skills invoking the deterministic CLI.
- Plausible future clients: dashboard/plugin clients consuming JSON output.
- Reusable product capabilities: central Change resolution, metadata parsing, migration planning, and lifecycle mutation.
- API or typed contract: existing CLI commands and JSON results; promotion is removed; update results gain migration actions/findings.
- OpenAPI plan, if HTTP-facing: not applicable.
- Backend platform exposed directly to clients?: not applicable.
- Client-specific presentation or local state: human output formats the same migration plan represented in JSON.
- Rationale: one internal store boundary prevents command-specific path logic from drifting.

## Alternatives Considered

- Keep repository copies and add a central index: rejected because copies remain competing truth.
- Keep legacy reads indefinitely: rejected because dual storage violates the requested clean cutover.
- Add an explicit migration command: rejected by the user in favor of automatic `sdd update` migration.

## Why This Approach

It directly implements the selected flat storage contract while preserving deterministic ownership through metadata. One shared store resolver reduces repeated path logic, and a preflight-first update migration preserves the package's existing fail-closed mutation standard.

## ADRs

- Required: yes.
- ADR path: `docs/adrs/2026-08-07-centralize-change-storage.md`.
- Decision summary: flat global user-level Change storage with metadata ownership and automatic fail-closed update migration.
- Reconsider when: Changes must travel with clones, a shared/team store is required, or global IDs collide routinely.

## Implementation Constraints

- Never infer ownership from prose when machine-readable metadata is missing or contradictory.
- Never remove a legacy source before every source/destination/config precondition and commit-time hash is valid.
- Preserve unrelated dirty files. An unavailable planning or repository owner that may contain legacy records blocks the locator-dropping migration; never treat it as empty or invent content.
- Serialize central lifecycle mutations under the user-store lock, compare-and-swap configuration writes, and make partially published artifacts transaction-owned and retryable.
- Do not leave compatibility aliases, repository Change-path keys, promotion prose, or dual-read paths after migration support is complete.

## Verification Strategy

- Focused automated tests: central create, metadata, global collisions, transitions, close, user-store operation routing, shared lifecycle locking, status, validation, automatic migration, exact planned-target recovery, unavailable legacy owners, identical/different duplicates, cross-Space collision, symlink confinement, concurrent config/source/destination edits, partial-publication cleanup, rollback, config upgrades, and rerun idempotence.
- Broad supporting gates: `npm run check` and skill validation for every changed packaged skill.
- Deterministic E2E: isolated temporary user home with legacy planned/active/closed fixtures, followed by `sdd update`, lifecycle commands, status, and validation against the central store.
- Live-provider or external-service playtests: not applicable.
- Manual UI confirmation: not applicable; this is CLI/filesystem behavior.
- Debug/log inspection: JSON command output and filesystem inspection of temporary fixtures.

## Decisions

- Flat global Change IDs and automatic update migration are user-confirmed.
- `tasks.md` frontmatter is the machine-readable ownership contract.
- Promotion is retired rather than retained as a no-op alias.
- Divergent duplicates fail closed; the migrator never merges Markdown content.

## Risks / Trade-Offs

- User-local Change records are not included in repository commits or PRs.
- Automatic update migration is consequential; dry-run must expose the complete plan, and normal update must abort before any Change mutation on ambiguity.
- Global IDs can collide across Spaces.
- Multi-root rollback and concurrent edits require stronger proof than a single rename.
- Existing private configs and repository contracts require coordinated schema migration before strict current validation.
