# Proposal: Centralize Change Storage

## Why

SDD currently distributes one Change lifecycle across private idea planning directories and repository-local active and closed folders. Promotion creates repository copies, so coordinated multi-repository work can diverge and future agents must rediscover which copy is authoritative. Every Change should instead have one canonical user-owned record.

## What Changes

- Store every proposed, planned, in-progress, and in-review Change at `~/.sdd/changes/<change-id>/`.
- Store closed history at `~/.sdd/changes/closed/<change-id>/`.
- Record the owning Space ID and target repository IDs in `tasks.md` frontmatter.
- Make Change IDs globally unique across the user installation.
- Retire idea-owned planned Change directories, repository-local Change copies, and promotion.
- Keep undated Change Briefs idea-owned under fixed `<planning-path>/change-briefs/`; migrate legacy brief files there without treating them as Changes.
- Make `sdd update` automatically migrate legacy planned, active, and closed Changes plus legacy undated brief files after a complete fail-closed preflight.
- Update the CLI, schemas, templates, packaged skills, workflow doctrine, tests, README, changelog, and durable Epic truth together.

## Target Repositories

- `sdd-skills` — CLI package, schemas, skills, templates, workflow, documentation, and tests.

## Epic Actions

### New Epic Directories

- None.

### Existing Epic Directory Updates

- `docs/epics/sdd-e001-reliable-cli-operations/epic.md`

## Epic Story Changes

- Modify `SDD-E001/S3` so unambiguous lifecycle routing means one user-level Change owner, global ID uniqueness, machine-readable Space/repository ownership, and fail-closed migration.
- Modify `SDD-E001/S6` so planning, Interactive, Apply, Review, PR, Release, and closeout use the central Change record and no longer depend on promotion or repository-local Change paths.
- Reconcile earlier S3 Requirements and evidence that describe idea-owned planned paths, repository-local active/closed collisions, or promotion as current behavior.

## Scope Decisions

- Confirmed: flat global Change IDs under `~/.sdd/changes`; status-driven active lifecycle; closed history under `closed/`; automatic migration during `sdd update`.
- Confirmed: one canonical Change record may target multiple repositories; target repository IDs are durable metadata rather than copies.
- Confirmed: divergent legacy copies fail the entire migration before any Change source is removed.
- Deferred: shared/team Change stores, hosted synchronization, repository-exported Change snapshots, and automatic backup/versioning of `~/.sdd`.
- Assumptions: `~/.sdd/config.yaml` remains the authoritative user topology and repository IDs from portable `.sdd/config.yaml` remain stable targeting keys.
- User decisions that shaped the Story/Requirement split: the user selected flat global IDs instead of Space namespaces and automatic update migration instead of an explicit migration command.

## Change Folder

- Bootstrap location: `docs/changes/2026-08-07-update-skills/`
- Canonical active location after migration: `~/.sdd/changes/2026-08-07-update-skills/`
- Canonical closed location: `~/.sdd/changes/closed/2026-08-07-update-skills/`

## Impact

- Product: developers and agents navigate one Change record through its entire lifecycle.
- Code: lifecycle storage resolution, creation, transition, close, status, validation, update migration, topology resolution, and CLI command/help behavior change.
- Tests: focused lifecycle, migration, collision, ownership, rollback, confinement, idempotence, status, validation, and workflow-contract coverage changes.
- Docs: repository layout, command reference, examples, templates, canonical doctrine, all path-bearing skills, README, and changelog change.
- ADRs: `docs/adrs/2026-08-07-centralize-change-storage.md` records the selected storage and migration contract.

## Release Communication Impact

- Required: yes.
- Record / section: `CHANGELOG.md` under the current Unreleased section, plus README command/layout guidance.
- Public summary: SDD Changes now live in one user-level store and `sdd update` migrates compatible legacy Change records automatically.

## Open Questions

- None. Implementation must surface divergent legacy content and unresolved repository identity as fail-closed migration errors rather than guessing.
