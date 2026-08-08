# ADR: Centralize Change Storage

- Status: Accepted
- Date: 2026-08-07
- Related change: `docs/changes/2026-08-07-update-skills/` (bootstrap location; the implemented migration moves it to `~/.sdd/changes/2026-08-07-update-skills/`)
- Related Epics / Stories: `SDD-E001/S3`, `SDD-E001/S6`

## Context

SDD currently splits Change truth across idea-owned planned drafts and repository-owned active and closed copies. Promotion duplicates one coordinated Change into selected repositories, which creates path-dependent lifecycle behavior and can leave divergent copies. The user selected one private user-level Change store as the canonical owner for every planned, active, and closed Change.

## Decision

Store every Change in a flat global user store:

- proposed, planned, in-progress, and in-review: `~/.sdd/changes/<change-id>/`
- closed: `~/.sdd/changes/closed/<change-id>/`

Each `tasks.md` frontmatter records the owning Space ID and target repository IDs alongside status. Change IDs are globally unique across Spaces. Repository copies and idea-owned planned Change directories are retired. Promotion is retired because a planned Change already occupies its canonical active location.

Undated Change Briefs are intent records rather than Changes. They remain idea-owned at `<planning-path>/change-briefs/<slug>.md`.

`sdd update` automatically preflights and migrates legacy planned, active, and closed Changes. It also moves undated legacy brief files from the retired planned-Change directory into the owning idea's fixed `change-briefs/` directory. It performs no Change, brief, or config writes when ownership, content, exact target repositories, global IDs, source availability, or brief destinations conflict. Legacy planned drafts preserve the repository paths recorded by the old CLI rather than expanding to every mapped repository. Byte-identical duplicate repository copies may be consolidated; divergent copies require manual reconciliation before update can continue.

## Options Considered

### Option 1: Space-Namespace, Status-Driven

- Summary: `~/.sdd/changes/<space-id>/<change-id>` with closed history under each Space.
- Pros: natural collision isolation and visible ownership.
- Cons: longer paths and a hierarchy the user explicitly declined.

### Option 2: Lifecycle Directories

- Summary: `~/.sdd/changes/<space-id>/{planned,active,closed}/<change-id>`.
- Pros: lifecycle is visible from paths and promotion can remain a central move.
- Cons: path churn and continued promotion semantics for a status already represented in `tasks.md`.

### Option 3: Flat Global IDs

- Summary: one global active root and one nested closed root.
- Pros: shortest stable active path, one canonical record, and status-driven lifecycle.
- Cons: Change IDs must be globally unique; Space and repository ownership must be machine-readable.

## Consequences

- Positive: one authoritative Change record survives planning, multi-repository implementation, review, and closeout.
- Positive: repository diffs contain implementation, Epics, ADRs, and release communication without duplicate working ledgers.
- Negative: Change records no longer travel with repository clones or PR diffs; `~/.sdd` backup/versioning becomes a user responsibility.
- Negative: global Change-ID collisions become hard errors.
- Negative: the first compatible `sdd update` may refuse to proceed until divergent legacy copies are reconciled.
- Follow-up: update CLI lifecycle commands, status, validation, schemas, setup/update migration, templates, skills, canonical workflow, README, changelog, tests, and SDD-E001 truth together.

## Validation

Focused tests must prove central creation, global collision refusal, metadata ownership, exact repository selection, status transitions, close moves, user-store confinement and lifecycle locking, status/validation discovery, automatic migration, unavailable-source refusal, identical-copy consolidation, divergent-copy fail-closed behavior, commit-time config and physical source checks, durable interruption recovery, partial-publication cleanup, rollback, symlink confinement, and rerun idempotence. `npm run check`, skill validation, scoped SDD validation, and an isolated end-to-end install/update smoke scenario must pass.

## Reconsider When

Reconsider if Change records must be portable with clones, multiple users need a shared Change ledger, global date-slug IDs collide in normal use, or a hosted/shared topology replaces the local user installation.
