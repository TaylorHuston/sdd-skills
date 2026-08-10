# ADR: Scope SDD Installation To One Workspace

- Status: Accepted
- Date: 2026-08-07
- Related Change ID: `2026-08-07-workspace-scoped-installation`
- Related Epics / Stories: `SDD-E001/S2`, `SDD-E001/S3`, `SDD-E001/S6`, `SDD-E001/S7`
- Supersedes: `docs/adrs/2026-08-07-centralize-change-storage.md`

## Context

The prior installation treated the operating-system user as the canonical SDD owner. It stored configuration and every Change under `~/.sdd`, installed managed skills under `~/.agents/skills`, and allowed commands to recover authority from the home directory. That made unrelated workspaces share one lifecycle namespace and let an external repository silently select an unrelated user-global topology.

The workspace already provides the useful coordination boundary: it groups private planning, one or more application repositories, shared workflow guidance, and managed skills. Repository contracts still need to remain portable and must not embed private workspace topology.

## Decision

Use one explicit workspace as the canonical owner of operational SDD state.

- Keep the canonical workspace configuration at `<workspace>/.sdd/config.yaml` using `version: 3`, `schema: sdd-v3`, `ideas`, and no `kind` discriminator.
- Store active and closed Changes under `<workspace>/.sdd/changes/`.
- Store the managed workflow, installation lock, migration journals, and recovery material under `<workspace>/.sdd/`.
- Install managed skills under `<workspace>/.agents/skills/` by default. A configured skill directory must remain lexically and physically inside the workspace.
- Keep each application repository's `.sdd/config.yaml` as the portable repository identity and artifact-location contract.
- Resolve command ownership from an explicit workspace, `SDD_WORKSPACE_ROOT`, the target's nearest workspace ancestor, or—only for a mapped external repository—the current directory's nearest workspace ancestor. Never fall back to `HOME` or `SDD_USER_HOME`.
- Treat Change IDs as unique within one workspace, not globally across every workspace on the machine.
- Accept old home-root workspace v1-v3 plus released transitional `kind: user` version 1 and version 2 configurations only through `sdd setup <workspace> --from-user <old-user-root>`.
- Make that migration a preflighted, staged transaction: publish and verify the complete destination before retiring checksum-owned source state; preserve unrelated files and skills; and recover or roll back after interruption only when a complete durable journal plus source-derived transaction provenance are independently bound to the workspace outside the staged transaction. Otherwise fail closed and retain the residue for manual inspection.

## Options Considered

### Keep One User-Global Installation

- Pros: one command namespace and one Change inventory for the machine.
- Cons: unrelated workspaces share authority, Change IDs, skills, and lifecycle state; home fallback can select the wrong owner; private topology is not relocatable as a workspace unit.

### Put Full SDD State In Every Repository

- Pros: clone-local behavior and conventional repository ownership.
- Cons: coordinated multi-repository Changes split into copies, private planning leaks into application repositories, and lifecycle state diverges.

### Workspace Owner With Portable Repository Contracts

- Pros: one authoritative multi-repository lifecycle per workspace, relocatable local topology, contained managed installation, no home ambiguity, and portable repository identity.
- Cons: commands need deterministic workspace selection; an external mapped repository requires an explicit or current-workspace context; separate workspaces may reuse the same Change ID.

## Consequences

- Positive: independent workspaces no longer share mutable SDD state or managed skills.
- Positive: all SDD-owned operational writes have one inspectable physical owner.
- Positive: repository clones retain public artifact contracts without acquiring private workspace topology.
- Positive: a workspace can coordinate repositories inside or outside its directory tree without making path containment imply ownership.
- Negative: developers must select a workspace when operating on an unmapped external repository.
- Negative: migration cannot be implicit; the old owner and every source/destination collision must be known before writes.
- Negative: workspace-local skills may be duplicated across workspaces by design.
- Negative: after an `sdd update` transaction commits, partial cleanup cannot continue if the complete source-derived destination guard set can no longer be reconstructed. Recovery fails closed and retains every remaining recovery artifact, including the surviving backup, unchanged journal, and staging directory, for manual inspection.
- Negative: interrupted home-migration cleanup has a separate boundary: it may resume only from complete source-derived transaction provenance whose exact bytes and stage identity are bound by independent workspace authority. Without that proof, setup also fails closed and retains state.

## Validation

Focused tests must prove workspace discovery precedence, no home fallback, external-repository mapping, schema-v3 compatibility, workspace confinement, portable repository initialization, workspace-local Change lifecycle, managed-skill checksum behavior, explicit user-v1/v2 migration dry-run, successful migration, collision and drift refusal, unrelated-state preservation, source retirement, and idempotent rerun. `test/cli.test.js#CLI setup migrates a released legacy user v1 source through dry-run and apply`, the existing user-v2 CLI migration test, and `test/workspace-config.test.js#released legacy user v1 is migration-only and preserves source-relative topology in workspace v3` cover the released legacy input boundary and canonical conversion. `test/update-migration.test.js#committed partial cleanup fails closed and retains remaining recovery state` proves the accepted `sdd update` limitation: when the complete source-derived destination guard set cannot be reconstructed after commit, recovery fails closed while preserving the remaining backup byte-for-byte, the unchanged journal, and the staging directory. Separately, `test/legacy-user-migration.test.js#legacy user migration recovery completes a partially removed directory retirement` proves that independently authenticated source-derived transaction provenance can finish the surviving subset of an interrupted home-migration retirement; `test/legacy-user-migration.test.js#legacy user migration never recursively removes opaque transfer-tree replacements` proves that a replaced retirement source fails closed and is retained; and `test/legacy-user-migration.test.js#legacy user migration recovery rejects a removed preserved Change guard before retirement` proves that rewritten staged provenance cannot replace the independent authority binding. The package gate, skill validation, scoped SDD validation, and a real dry-run plus migration must pass before review handoff.

## Reconsider When

Reconsider if SDD gains a durable shared service with explicit tenant/workspace identity, if multiple people must concurrently mutate one workspace Change store, or if application repositories become the sole acceptable owner of all planning and lifecycle records.
