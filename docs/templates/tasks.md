# Tasks: CHANGE TITLE

## Resume Here

Keep one replaceable checkpoint for the current delivery state. Candidate values are watermarks, not evidence logs: a working-tree watermark identifies HEAD plus the staged, unstaged, and relevant untracked snapshot; a committed candidate uses its resolved SHA. Replace stale values rather than appending history.

- Change: `<change-id>`
- Current slice: S1
- Phase: planned
- Verification candidate: pending
- Review candidate: pending
- Epic-update candidate: pending
- Changelog candidate: pending
- Acceptance candidate: not required
- Open finding / blocker: none

| Repository | Root | Baseline | Candidate kind | Candidate watermark |
|---|---|---|---|---|
| `<repository-id>` | `<resolved-root>` | not captured | not started | not captured |

## Requirement Slices

Each slice describes what behavioral work remains, not how to implement it. Default to exactly one Requirement as the smallest practical vertical unit that can become independently green. Combine Requirements only when completing either in isolation would be incoherent, and record a concise `Coupling justification`. Every slice must be completable atomically in one fresh Apply session from committed dependencies through verification, final Review, Epic reconciliation, and its local commit. Keep each slice independently understandable so that session can gather fresh repository context without inheriting a speculative technical recipe.

Order is advisory. `/sdd-apply` may choose any ready slice and may resequence, split, or merge slices when implementation evidence warrants it. Update this file when that happens; route genuine scope or behavioral changes back through `/sdd-change`.

Omit non-applicable `New`, `Revised`, `Create`, `Update`, `Consumes`, or `Produces` entries rather than retaining placeholders. Add interface contracts only when another slice or repository depends on them.

### S1: <Behavioral outcome>

- Status: ready
- Repository: `<repository-id>`
- Requirements:
  - New: `EPIC-ID/S3 R1` — <requirement summary>
- Story changes:
  - Create: `EPIC-ID/S3` — <Story title>
- Outcome: <Short stand-alone summary of the observable behavior that must be true when this slice is complete.>
- Scenarios: `EPIC-ID/S3 R1-S1`
<!-- Add `- Coupling justification: <why separate atomic sessions would be incoherent>` only when Requirements contains more than one row. -->
- Dependencies: none
- Binding constraints: none
- Consumes: `<interface or behavior supplied elsewhere>`
- Produces: `<interface or behavior another slice relies on>`
- Verification intent: <Focused Scenario-based proof expected for this slice.>
- Manual acceptance: not required / <specific observation the user must confirm>
- Closure receipt: required
- Visual requirements:
  - Not applicable — <reason no rendered surface changes>.
  - `V1` — Scenarios: `EPIC-ID/S3 R1-S1` — <one independently accountable viewport, state, interaction, and expected observation; remove the Not applicable entry when using V# rows>

## Implementation Ledger

Keep one current-state row per slice. `/sdd-change` initializes the rows and `/sdd-apply` updates the selected row as implementation proceeds. Summarize the observable result and actual changed surface after discovery; do not record predicted implementation steps, command history, detailed verification evidence, or review transcripts here. The Commit cell remains `pending` until Apply creates the final reviewed slice commit, then records its full 40-character SHA.

| Slice | Repository | Status | Implementation Summary / Changed Surface | Commit | Updated |
|---|---|---|---|---|---|
| S1 | `<repository-id>` | not started | None yet. | pending | yyyy-mm-dd |

## Slice Gate Ledger

Keep one durable current-state gate row per slice. Apply updates this row after each candidate-bound gate and before completion. For each slice marked `Closure receipt: required`, Apply writes a durable detailed `slice-reviews/<slice-id>.md` and generated minimal `slice-closures/<slice-id>.yaml` before `done`. The receipt references and hashes the final Review, indexes exact Scenario and visual results/gaps, and seals reviewed-tree/final-tree equality; detailed reasoning remains in the Review. Watermarks identify exact candidates; use a full 40-character lowercase commit SHA, `commit:<full-sha>`, or `working-tree:<full-head-sha>:sha256:<64-character-lowercase-digest>`, and use that exact same watermark after `@` in dependent result cells. They do not replace the cited Story evidence. A done slice requires a fresh verification candidate, `ready` implementation Review, `complete` or `no-op` Epic Update, semantic and evidence closure `pass`, `ready` post-Epic Review when reconciliation changed the candidate, no required technical gaps, and the same full commit recorded in the Implementation Ledger. Record accepted gaps only after the user explicitly accepts the named gap and include the acceptance date.

| Slice | Verification Candidate | Implementation Review | Epic Update | Semantic Closure | Evidence Closure | Post-Epic Review | Required Gaps | Accepted Gaps | Final Commit | Updated |
|---|---|---|---|---|---|---|---|---|---|---|
| S1 | pending | pending | pending | pending | pending | pending | none | none | pending | yyyy-mm-dd |

## Blockers / Open Questions

- None.

## Closeout

- Remaining slices: S1
- Review: pending
- Manual confirmation: pending / not applicable
- Accepted gaps: none

Slices planned or reopened under the current workflow declare `Closure receipt: required` and cannot become `done` without an owner-confined `slice-reviews/<slice-id>.md` plus `slice-closures/<slice-id>.yaml`. Legacy v1 certificates and existing completed slices without the current marker remain compatible; upgrade them only when they explicitly reopen. Delete or invalidate a required receipt whenever its slice, candidate, Review, gap disposition, or visual requirements reopen.

Add only the conditional coordination or evidence sections that this Change actually needs during delivery or review. Do not pre-create implementation steps, predicted file lists, engineering matrices, verification logs, or release questionnaires. The checkpoint, lightweight Implementation Ledger, and compact Slice Gate Ledger are current-state resume aids, not a chronological diary or evidence store. The gate ledger preserves candidate-bound verdicts and gap classification outside the replaceable checkpoint; it does not duplicate test details or review transcripts. Its commit SHA is the durable boundary for the completed slice, not a substitute for Scenario evidence. Durable implementation and verification evidence belongs in the affected Stories' `Implemented By` and `Verified By` maps; candidate-bound slice reasoning belongs in `slice-reviews/<slice-id>.md`; final Change-wide integration Review remains `review.md`.
