# ADR: Centralize Change Storage

- Status: Superseded
- Date: 2026-08-07
- Superseded by: `docs/adrs/2026-08-07-workspace-scoped-installation.md`
- Related Change ID: `2026-08-07-workspace-scoped-installation`
- Related Epics / Stories: `SDD-E001/S3`, `SDD-E001/S6`

## Context

SDD currently splits Change truth across idea-owned planned drafts and repository-owned active and closed copies. Promotion duplicates one coordinated Change into selected repositories, which creates path-dependent lifecycle behavior and can leave divergent copies. The user selected one private user-level Change store as the canonical owner for every planned, active, and closed Change.

This decision used the operating-system user as the owner. That boundary is superseded: the selected workspace now owns the canonical Change store and managed SDD installation, Change IDs are workspace-unique, and released user-v1/v2 configurations are explicit migration-only inputs. The superseding recovery contract distinguishes two limits: committed `sdd update` cleanup fails closed and retains its remaining backup, unchanged journal, and staging directory when the complete source-derived destination guard set cannot be reconstructed; home-migration cleanup separately requires complete source-derived transaction provenance bound by independent workspace authority.

## Decision

Store every Change in a flat global user store:

- proposed, planned, in-progress, and in-review: `~/.sdd/changes/<change-id>/`
- closed: `~/.sdd/changes/closed/<change-id>/`

Under this superseded user-store decision, each `tasks.md` frontmatter recorded the owning Space ID and target repository IDs alongside status, and Change IDs were machine-user-global across Spaces. The accepted replacement makes Change IDs unique only within the selected workspace. Repository copies and idea-owned planned Change directories remain retired, and promotion remains retired because a planned Change already occupies its canonical active location.

Undated Change Briefs are intent records rather than Changes. They remain idea-owned at `<planning-path>/change-briefs/<slug>.md`.

Under the superseded user-store workflow, `sdd update` automatically preflighted and migrated legacy planned, active, and closed Changes. It also moved undated legacy brief files from the retired planned-Change directory into the owning idea's fixed `change-briefs/` directory. It performed no Change, brief, or config writes when ownership, content, exact target repositories, machine-user-global IDs, source availability, or brief destinations conflicted. Legacy planned drafts preserved the repository paths recorded by the old CLI rather than expanding to every mapped repository. Byte-identical duplicate repository copies could be consolidated; divergent copies required manual reconciliation before update could continue. Current home-to-workspace migration is instead explicit and makes no automatic cleanup claim without complete source-derived provenance.

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
- Historical negative: machine-user-global Change-ID collisions were hard errors; the superseding workspace store enforces workspace-unique IDs instead.
- Negative: the first compatible `sdd update` may refuse to proceed until divergent legacy copies are reconciled.
- Follow-up: update CLI lifecycle commands, status, validation, schemas, setup/update migration, templates, skills, canonical workflow, README, changelog, tests, and SDD-E001 truth together.

## Validation

This superseded decision required focused tests for central creation, machine-user-global collision refusal, metadata ownership, exact repository selection, status transitions, close moves, user-store confinement and lifecycle locking, status/validation discovery, automatic legacy migration, unavailable-source refusal, identical-copy consolidation, divergent-copy fail-closed behavior, commit-time config and physical source checks, durable interruption recovery, partial-publication cleanup, rollback, symlink confinement, and rerun idempotence. The current workspace-scoped ADR narrows those recovery claims. `test/update-migration.test.js#committed partial cleanup fails closed and retains remaining recovery state` proves that committed update cleanup without a reconstructable complete source-derived destination guard set fails closed while retaining the remaining backup byte-for-byte, unchanged journal, and staging directory. Separately, `test/legacy-user-migration.test.js#legacy user migration recovery completes a partially removed directory retirement` covers a provenance-authenticated remaining home-migration subset, while incomplete source-derived transaction provenance must fail closed and retain state.

## Reconsider When

Reconsider if Change records must be portable with clones, multiple users need a shared Change ledger, global date-slug IDs collide in normal use, or a hosted/shared topology replaces the local user installation.
