---
name: sdd-gather-context
description: Gather the minimum planning, repository, decision, behavior, implementation, test, and Git context required before an SDD exploration, ADR, or Change makes claims. Use from sdd-explore, sdd-adr, or sdd-change with an action (`exploration`, `adr`, or `change`) and a focused question. Read-only, same-session, and artifact-free.
---

# SDD Gather Context

Gather evidence for the caller's focused question, then return control. This is shared reading discipline, not a separate investigation record or workflow.

## Invocation

Require:

- action: `exploration`, `adr`, or `change`;
- focused question or desired outcome;
- known Space, repository IDs, and starting artifact paths when available.

If the question is too broad to decide relevance, ask the caller or user to narrow it before scanning repositories.

## Common Minimum

Reuse files already read in the current session when they are current and complete. Open the missing minimum:

1. `sdd context <relevant-path> --json` and the returned `workflowPath`.
2. Applicable workspace, planning, and repository `AGENTS.md` files.
3. The idea's front-door note and PRD/Product Brief when an idea owns the topic.
4. `sdd status <space-id> --json`, including active/recent central Changes and mapped repository Git summaries.
5. Each relevant repository's README and architecture/context index when present, such as `CONTEXT.md`, `CONTEXT-MAP.md`, `docs/README.md`, or an equivalent named by project guidance.

For an exploration with no SDD or repository owner, mark SDD-only entries `not applicable` and follow the selected record owner's guidance instead of inventing topology.

Use status and indexes as navigation, not proof. Follow only references capable of changing the answer, exposing an existing decision, or identifying the owner of affected behavior.

## Action Minimums

### `exploration`

Read at minimum:

- matching existing explorations or durable discussion records;
- relevant strategy, research, marketing, design, or planning notes named by the front door or local guidance;
- active/recent Changes and governing ADRs touching the question;
- relevant Epic summaries when accepted or proposed behavior matters;
- code and tests only when feasibility, cost, current behavior, or implementation constraints are part of the question.

### `adr`

Read at minimum:

- the invoking exploration or Change, including its decision question and options already identified;
- existing ADRs and project guidance governing the affected area;
- affected Epic Requirements/Scenarios when the decision constrains behavior;
- current code, tests, dependencies, schemas/contracts, and operational configuration at the affected seam;
- current primary vendor documentation when an option depends on version-sensitive behavior.

### `change`

Read at minimum:

- the selected `change.md` and `tasks.md` when it exists, plus an existing `design.md` only for a Change that already has one;
- matching explorations and relevant PRD direction;
- active/recent Changes that overlap or constrain the outcome;
- governing ADRs;
- affected Epics, Stories, Requirements, and Scenarios;
- current implementation, tests, dependencies, and contracts for the affected behavior;
- repository branch, dirty state, and relevant diff when current work may overlap the Change.

## Reconcile

When sources disagree, name the conflict and apply their authority:

- PRDs guide product direction.
- Epics define accepted behavior.
- ADRs govern durable technical decisions until superseded.
- Changes describe intended deltas and work state.
- Code and tests reveal current implementation reality.
- Explorations remain non-authoritative source context.

Treat freshness separately from authority. A stale authoritative artifact is drift to surface, not permission to silently replace it with a newer informal note.

## Completion Criterion

Return a compact result in the current session:

```markdown
## Gathered Context

- Purpose:
- Space and repositories:
- Sources read: <paths grouped by planning, decisions, behavior, implementation/tests, and Git>
- Current state:
- Governing decisions and constraints:
- Conflicts or drift:
- Gaps and assumptions:
- Sufficiency: sufficient / insufficient for <focused question>, because ...
- Next targeted read, if insufficient:
```

Context is sufficient when every applicable minimum above was read or explicitly marked missing or not applicable, source conflicts are visible, and another read is unlikely to change the caller's next decision. Do not claim universal completeness.

Stay read-only. Create no artifact, mutate no lifecycle, make no product or architecture decision, and launch no subagent unless the caller separately authorizes delegation.
