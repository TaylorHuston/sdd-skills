# ADR: Use One Progressive Change Record

- Status: Accepted
- Date: 2026-08-10
- Related Change ID: `2026-08-10-simplify-change-workflow`
- Related Epics / Stories: `SDD-E001`

## Context

SDD previously stored early intent as an undated Change Brief, created a dated `proposal.md` only when technical planning began, and stored lifecycle metadata in `tasks.md`. This required separate `/sdd-change --brief`, `--plan`, and `--replan` modes, duplicated intent across artifacts, and coupled status operations to an implementation ledger.

## Decision

Use one progressive workspace-central Change from initial intent onward.

- `change.md` owns intent, status, Space, and repository IDs.
- A `proposed` Change requires only `change.md`; repositories may be empty.
- Technical planning adds `design.md` and `tasks.md`.
- Transition to `planned` requires repository ownership plus both planning artifacts.
- `/sdd-change` infers whether to create, resume, plan, or revise from context and current status rather than mode flags.
- Lifecycle mutations use proportional workspace-locked filesystem operations rather than bespoke transaction journals.
- Pre-1.0 installations, schemas, and Change formats have no supported programmatic migration path. `sdd update` reconciles only current managed doctrine and skills.

## Options Considered

### Separate Brief And Planned Change

- Pros: keeps backlog intent physically separate from active planning.
- Cons: duplicates the outcome, requires promotion semantics, and makes resumption more complex.

### One Change With All Files Scaffolded Immediately

- Pros: preserves the existing fixed directory shape.
- Cons: empty planning artifacts imply false completeness and keep status coupled to tasks.

### Add A Draft Status

- Pros: explicitly names the intake stage.
- Cons: duplicates the meaning already provided by `proposed`.

### Preserve Programmatic Alpha Migration

- Pros: automatically carries previous installation and Change formats forward.
- Cons: retains more transaction, recovery, dual-schema, and compatibility code than the alpha data warrants.

## Consequences

- Positive: one command, one intent record, one lifecycle authority, and status-aware artifact requirements.
- Positive: proposed work appears in status immediately and can be resumed naturally.
- Positive: lifecycle command code and tests become substantially smaller.
- Negative: existing Changes and old workflow references require one-time manual conversion or recreation.
- Negative: removing crash-recovery journals accepts a smaller failure-safety envelope appropriate to the local pre-1.0 workflow.
- Follow-up: simplify the remaining skills and remove obsolete compatibility tests and dead migration helpers.

## Validation

Focused command-level tests cover create, status, status-aware validation, planning transition, lifecycle transitions, and close. Package validation must also confirm that managed skills, doctrine, README, templates, and Epic truth use the new contract consistently.

## Reconsider When

- SDD becomes a multi-process or hosted service where concurrent writers are expected.
- Proposed Changes need a materially different lifecycle or access policy from planned Changes.
- Real usage shows that one progressive record obscures rather than clarifies backlog intent.
