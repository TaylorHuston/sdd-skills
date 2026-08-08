# Review: Centralize Change Storage

## Scope

- Space: `sdd-skills`
- Target repository IDs: `sdd-skills`
- Repositories reviewed: `sdd-skills`
- Review target: `develop`
- Review source: uncommitted `update-skills` working tree
- Review date: 2026-08-07

## Verdict

`ready-for-review` — all seven findings are fixed with focused regressions, both independent remediation rechecks passed, and the final aggregate gate is green.

## Gate Scorecard

| Gate | Result | Evidence |
|---|---|---|
| Central Change storage and lifecycle | pass | Central lifecycle, status, validation, and migration suites pass. |
| Migration recovery security | pass | Independent recheck confirmed topology/identity authorization, crash-consistent config replacement, honest committed-cleanup replay, and fail-closed journal/content validation. |
| Configuration authority and input safety | pass | Independent recheck confirmed canonical user authority plus typed rejection of malformed current and legacy paths before filesystem access. |
| Status and validation ownership | pass | Repositoryless/stale-target Changes remain visible and unknown Space ownership fails validation. |
| Multi-repository release contract | pass | Independent contract recheck confirmed repository-keyed authority/evidence for every target plus aggregate closeout. |
| Full package verification | pass | `npm run check`: 255/255 tests and packaged CLI help passed after final remediation. |
| Structural SDD validation | pass | Isolated scoped validation: 1 Change, 1 Epic, 0 errors; three acknowledged large-Story warnings. |
| Manual UI confirmation | not applicable | No application UI changed. |

## Findings

### R1 — Durable journal recovery trusted attacker-controlled mutation paths

- Severity: high
- Status: remediated; independent recheck passed
- Files: `src/update-migration.js`, `test/update-migration.test.js`
- Resolution: recovery reconstructs authorization from current topology, requires exact physical owner identities, confines journals/staging paths, validates deterministic destinations/backups and record phases, and rejects journal-directed mutations outside those boundaries. Committed recovery independently checks published Change/Brief/config contents and source-removal state before cleanup. Regressions prove a modified journal cannot overwrite or remove unrelated data, hide an incomplete destination, or discard an unremoved source.

### R2 — Malformed configured paths escaped typed diagnostics

- Severity: high
- Status: remediated; independent recheck passed
- Files: `src/config.js`, `src/commands/update.js`, `test/cli.test.js`
- Resolution: every user/repository path family rejects NUL bytes before normalization or filesystem use; update validates raw legacy `migration.sourceWorkspace` before migration can normalize it away; referenced non-string current roots and non-string legacy root arrays return typed `INVALID_CONFIG` rather than native exceptions. Command-entry regressions cover all failure classes.

### R3 — Release handoff modeled one repository while closeout was global

- Severity: medium-high
- Status: remediated; independent recheck passed
- Files: `skills/sdd-release/SKILL.md`, `skills/sdd-release/assets/release-pr-template.md`, `docs/templates/release-pr.md`
- Resolution: release resolves the complete target set, applies policy and verification per repository, records exact repository-keyed candidates and handoffs, requires cross-repository coordination evidence, and gates the one global closeout on every target.

### R4 — A repository-local user-shaped config could replace canonical authorization

- Severity: high
- Status: remediated; independent recheck passed
- Files: `src/workspace.js`, `src/commands/configure.js`, `test/cli.test.js`
- Resolution: operational context is seeded from the canonical `userRoot` configuration and may only augment that clone with a portable repository-only contract. Configuration inspection rejects a noncanonical user-shaped config root before use. Nested mutation and configure regressions prove the local config cannot introduce or authorize an otherwise unknown Space.

### R5 — Config replacement interruption could strand the canonical path

- Severity: medium
- Status: remediated; independent recheck passed
- Files: `src/fs.js`, `src/commands/update.js`, `src/update-migration.js`, `test/update-migration.test.js`
- Resolution: forward and rollback replacements durably journal their exact temporary/backup paths and phases before rename; missing-target recovery restores only a verified original artifact and can itself resume after interruption. Update bootstraps recovery under the user-root lock even when the canonical config is temporarily absent. Honest committed `verified`/`removed`/`cleaned` states resume cleanup, while contradictory phases, altered contents, present legacy sources, and malformed status claims retain recovery artifacts and fail closed.

### R6 — Default status dropped repositoryless and inactive-target Changes

- Severity: high
- Status: remediated
- Files: `src/commands/status.js`, `src/cli.js`, `test/cli.test.js`
- Resolution: Space-level active/recent inventory retains every canonical Space-owned Change; repository filtering affects only repository projections, and summary output adds a Space row when no selected repository owns a Change.

### R7 — Validation accepted central Changes owned by an unknown Space

- Severity: medium
- Status: remediated
- Files: `src/commands/validate.js`, `test/cli.test.js`
- Resolution: central validation checks every parsed `space` against configured Space IDs before repository ownership and emits `SPACE_NOT_FOUND`.

## Accepted Platform Limits

- Node exposes no portable directory-relative `openat`/`renameat2` API; the residual same-UID ancestor-swap window after the final physical check is accepted and documented.
- Regular-file hardlinks do not make these rename-based writers modify the other link; directory hardlink prevention remains kernel-defined.
- PID reuse can conservatively strand a mutation lock. Automatic reclamation cannot portably prove process birth identity, so the implementation fails closed.

## Remaining Review Work

- Run independent `/sdd-review` before any integration handoff.
