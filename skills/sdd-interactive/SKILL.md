---
name: sdd-interactive
description: Create and apply one lightweight v2 SDD Change in a tracked interactive session. Use for small UI tweaks, narrow defects, polish, or minor behavior refinements that deserve durable intent, one outcome, independent Review, Epic reconciliation when needed, and one local commit.
---

# SDD Interactive

Provide a thin convenience route through the same Change, Apply, Review, and Epic contracts. Do not maintain a separate artifact shape or implementation doctrine.

## Fit

Use Interactive when the requested work:

- has a concrete and narrow observable outcome;
- fits one repository and one coherent delivery outcome;
- requires no unresolved product, architecture, data, auth, public API, migration, deployment, or external-service decision;
- can be implemented, focused-verified, independently reviewed, and locally committed in one session.

Route broader or uncertain work to `/sdd-change`. Route a consequential technical choice to `/sdd-adr` and unresolved experience direction to `/sdd-design`.

## Resolve And Preflight

Resolve workspace, Space, repository, managed workflow, and active Changes with `sdd context` and `sdd status`. Read applicable `AGENTS.md`, repository docs, package scripts, relevant Epic truth, and Git state. Preserve unrelated work and obey branch policy.

Continue an existing matching v2 Change only when its intent and repository are unambiguous. Otherwise create one:

```bash
sdd change create <space-id> <slug> --repo <repository-id>
```

Schema-less Changes are unsupported; do not retrofit them through this shortcut.

## Create The Minimal Current Records

Use the normal v2 Change templates, not an Interactive-specific format:

```text
<workspace>/.sdd/changes/<change-id>/
  change.md
  tasks.md
  review.md
```

Keep them concise:

- `change.md`: why, desired outcome, scope/non-goals, success signals, constraints, repository/Epic impact, selected straightforward approach, verification strategy, risks, and stop conditions;
- `tasks.md`: one `S1` outcome with Requirements, Story changes, Scenarios, constraints, expected triggers, focused verification, and manual acceptance;
- `review.md`: one pending S1 section with the five universal gates and planned triggers.

Describe what should become true. Do not add request logs, implementation ledgers, verification ledgers, fixed gate matrices, predicted files, implementation steps, receipts, or duplicate templates.

Transition the coherent Change from `proposed` to `planned`, run focused validation, then compose `/sdd-apply S1`. Apply owns implementation method, proportional verification, independent Review, conditional Epic reconciliation, selective local commit, and the final central records.

## Session Boundary

Interactive handles exactly one outcome. It does not:

- consume follow-up outcomes;
- weaken candidate, Review, gap, acceptance, or commit integrity;
- authorize broad staging, push, PR, merge, release, deployment, destructive action, or closeout;
- turn user feedback into untracked scope expansion.

If feedback changes accepted behavior before completion, return to `/sdd-change`. If manual acceptance is required, keep it separate from technical readiness.

## Result

Return the composed Apply status: `complete`, `no-op`, `needs-user`, `blocked`, or `routed`.

Report the central Change path, outcome handled, artifacts updated, focused verification, Review and Epic results, local commit, manual acceptance, remaining gaps, and whether final `/sdd-review` is next.

## Self Improvement

Report one concrete improvement only when the session exposed recurring friction. Do not create an Interactive-only mechanism to solve it.
