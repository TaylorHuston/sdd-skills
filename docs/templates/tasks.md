# Tasks: CHANGE TITLE

## Resume Here

- Current slice: S1
- Last completed: planning
- Next action: implement or delegate S1
- Blockers: none

## Requirement Slices

Each slice describes what behavioral work remains, not how to implement it. Use one distinct Requirement or a small group of closely related Requirements as the smallest practical vertical unit that can become independently green. Each slice needs its own observable outcome, focused Scenario-based test cycle, and meaningful review verdict; rejecting one slice should not necessarily reject adjacent slices. Keep each slice independently understandable so an isolated implementation agent can gather fresh repository context and deliver it without inheriting a speculative technical recipe.

Order is advisory. `/sdd-apply` may choose any ready slice and may resequence, split, or merge slices when implementation evidence warrants it. Update this file when that happens; route genuine scope or behavioral changes back through `/sdd-change`.

Omit non-applicable `New`, `Revised`, `Create`, `Update`, `Consumes`, or `Produces` entries rather than retaining placeholders. Add interface contracts only when another slice or repository depends on them.

### S1: <Behavioral outcome>

- Status: ready
- Repository: `<repository-id>`
- Requirements:
  - New: `EPIC-ID/S3 R1` — <requirement summary>
  - Revised: `EPIC-ID/S1 R2` — <required behavioral revision>
- Story changes:
  - Create: `EPIC-ID/S3` — <Story title>
  - Update: `EPIC-ID/S1` — <reason>
- Outcome: <Short stand-alone summary of the observable behavior that must be true when this slice is complete.>
- Scenarios: `EPIC-ID/S3 R1-S1`, `EPIC-ID/S1 R2-S1`
- Dependencies: none
- Binding constraints: none
- Consumes: `<interface or behavior supplied elsewhere>`
- Produces: `<interface or behavior another slice relies on>`
- Verification intent: <Focused Scenario-based proof expected for this slice.>
- Manual acceptance: not required / <specific observation the user must confirm>

## Implementation Ledger

Keep one current-state row per slice. `/sdd-change` initializes the rows and `/sdd-apply` updates the selected row as implementation proceeds. Summarize the observable result and actual changed surface after discovery; do not record predicted implementation steps, command history, verification evidence, commit hashes, or review state here.

| Slice | Repository | Status | Implementation Summary / Changed Surface | Updated |
|---|---|---|---|---|
| S1 | `<repository-id>` | not started | None yet. | yyyy-mm-dd |

## Blockers / Open Questions

- None.

## Closeout

- Remaining slices: S1
- Review: pending
- Manual confirmation: pending / not applicable
- Accepted gaps: none

Add only the conditional coordination or evidence sections that this Change actually needs during delivery or review. Do not pre-create implementation steps, predicted file lists, engineering matrices, verification logs, or release questionnaires. The lightweight Implementation Ledger is a current-state resume aid, not a chronological diary or evidence store. Durable implementation and verification evidence belongs primarily in the affected Stories' `Implemented By` and `Verified By` maps and in `review.md` when review findings exist.
