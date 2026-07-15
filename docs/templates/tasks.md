---
status: proposed
---
# Tasks: CHANGE TITLE

## Resume Here

- Last completed action: change artifacts drafted
- Next action: review proposal, design, and tasks
- Active branch/ref: unknown
- Expected dirty files: `docs/changes/yyyy-mm-dd-change-name/`
- Known blockers: none identified yet

## Task Checklist

### 1. Planning Quality

- [ ] 1.1 Summarize the proposed scope boundary and confirm any unresolved decisions.
- [ ] 1.2 Challenge each proposed Story for user-path fit, Epic ownership, and unnecessary UI-task fragmentation.
- [ ] 1.3 Refine Requirements and Scenarios into observable behavior, including relevant happy path, empty state, failure mode, permission/validation case, recovery path, integration boundary, or security-sensitive condition.
- [ ] 1.4 Record assumptions, open questions, candidate Stories, and deferred scope instead of silently promoting uncertain behavior into accepted Requirements.
- [ ] 1.5 Confirm the planned `Verified By` sections can become scenario-mapped evidence indexes.
- [ ] 1.6 For UI-bearing changes with material experience uncertainty, complete `/sdd-design` or record why existing product conventions already make the direction implementation-ready.
- [ ] 1.7 Set `status: planned` only after the proposal, design, tasks, Epic actions, and verification strategy are coherent and validated.

### 2. Epic Artifacts

- [ ] 2.1 Create or update the Epic directories named in `proposal.md` and `design.md`.
- [ ] 2.2 Create or update each Epic's `epic.md` file.
- [ ] 2.3 Confirm each Story has a stable Epic-scoped label or documented legacy Story ID, local Requirement IDs, local Scenario IDs, Implemented By, Verified By, and Verification Gaps.
- [ ] 2.4 Check whether this change supersedes earlier Story, Requirement, Scenario, Verified By, or Verification Gaps wording; reconcile any stale truth.

### 3. Architecture Decisions

- [ ] 3.1 Confirm `design.md` compares viable technical options or records why only one path is reasonable.
- [ ] 3.2 Create or update ADRs named in `design.md` when the change makes durable architecture decisions.
- [ ] 3.3 Confirm ADR status is accurate: proposed / accepted / superseded / not applicable.

### 4. Implementation

- [ ] 4.1 Implement Requirements through BDD/TDD phases.
  - [ ] Story: EPIC-ID/S1 - STORY TITLE
    - [ ] Requirement R1: REQUIREMENT TITLE
      - [ ] Scenario R1-S1: PRIMARY SCENARIO
      - [ ] Scenario R1-S2: FAILURE OR EMPTY STATE SCENARIO
- [ ] 4.2 Add short enabling phases only when needed before a Requirement can be tested or implemented.
- [ ] 4.3 Update Story-level Implemented By maps with current code locations.

### 5. Verification

- [ ] 5.1 Add or update focused verification for each implemented Requirement and Scenario.
- [ ] 5.2 Update Story-level Verified By maps with scenario-mapped evidence, not chronological command logs.
- [ ] 5.3 Label evidence types where useful: focused automated test, broad supporting gate, deterministic E2E, live-provider playtest, manual UI confirmation, or debug/log inspection.
- [ ] 5.4 Verify ADR assumptions or record the remaining decision risk.
- [ ] 5.5 Run scoped `sdd validate` and resolve deterministic artifact errors before handoff.

### 6. Review And Closeout

- [ ] 6.1 Update the project-defined release communication when `proposal.md` says release-communication impact is required or TBD.
- [ ] 6.2 Run `sdd-review` as the local PR gate for Requirements, Scenarios, Epic truth, tests, security, docs, release communication, ADR consistency, and branch readiness.
- [ ] 6.3 Record review outcome as a `review.md` path, a clean review recorded in this ledger, or an explicit user-approved review waiver.
- [ ] 6.4 Address any `review.md` findings or explicitly defer accepted non-blocking risks.
- [ ] 6.5 Record manual UI confirmation status as `not applicable`, `pending user`, `user confirmed`, or `accepted gap`.
- [ ] 6.6 Confirm proposal/design/tasks/review artifacts do not still claim completed work is not implemented, not verified, pending, or accepted under obsolete manual status vocabulary.
- [ ] 6.7 Confirm machine-readable Change status agrees with Resume Here, checklist, review, manual confirmation, release communication, ADR, PR/merge, deferred-gap, and folder-location claims.
- [ ] 6.8 Keep `status: in_review` while independent review and closeout gates are underway.
- [ ] 6.9 Create a PR or merge only after `sdd-review` is ready and the app branch policy plus user authorization allow it.
- [ ] 6.10 After review/PR/merge/acceptance is complete and `status: in_review` remains accurate, run `sdd change close` for this Space and Change instead of writing a `closed` status.

## Implementation Ledger

Record meaningful Requirement, Scenario, enabling, or delegated slices as they happen. Keep entries short.

| Date | Slice | Agent / Guidance | Files / Areas | Result | Commit / Ref |
|---|---|---|---|---|---|
| YYYY-MM-DD | EPIC-ID/S1 R1/R1-S1 TBD | main or subagent TBD | TBD | TBD | TBD |

## Verification Ledger

Record proof as it happens. Keep chronological command output here; summarize only durable scenario-mapped evidence into Epic `Verified By`. Do not blur deterministic E2E, live-provider playtests, manual UI confirmation, broad gates, and debug/log inspection into one evidence bucket.

| Date | Check | Evidence Type | What It Proves | Result |
|---|---|---|---|---|
| YYYY-MM-DD | TBD | focused automated test / broad supporting gate / deterministic E2E / live-provider playtest / manual UI confirmation / debug-log inspection | EPIC-ID/S1 R1/R1-S1 TBD | TBD |

## Manual Feedback

Record the user's manual testing feedback after implementation starts.

| Date | Feedback | Classification | Action / Artifact Updates | Status |
|---|---|---|---|---|
| YYYY-MM-DD | TBD | defect / verification gap / artifact drift / requirement refinement / scope expansion / product drift | TBD | open |

## Planning Updates

Record `/sdd-change --replan` updates when implementation or feedback discovers planning-level requirements.

| Date | Discovery | Classification | Planning Updates | Next Apply Starting Point |
|---|---|---|---|---|
| YYYY-MM-DD | TBD | in-scope refinement / scope expansion / product drift / Epic ownership change / technical constraint / follow-up change | proposal.md / design.md / tasks.md | `/sdd-apply` TBD |

## Design Updates

Record `/sdd-design --revise` work when implementation, comparison, review, or manual feedback requires another experience-design pass without changing accepted behavior.

| Date | Feedback / Discovery | Classification | Reference / Target | Preserve / Change / Non-Goals | Artifact Updates | Next Apply Starting Point |
|---|---|---|---|---|---|---|
| YYYY-MM-DD | TBD | experience refinement / experience defect / accessibility correction / responsive correction | TBD | TBD | design.md / tasks.md | `/sdd-apply` TBD |

## Manual UI Confirmation

- Status: pending user / user confirmed / accepted gap / not applicable
- App URL / route:
- Required setup or test data:
- Steps for the user:
- Expected result:
- Feedback that would change artifacts:

## Blockers / Open Questions

- None identified yet.

## Closeout

- Change status:
- Epic files updated:
- Story labels/references and Requirement/Scenario IDs current:
- Implemented By maps current:
- Scenario-mapped Verified By maps current:
- Superseded earlier Epic truth reconciled:
- ADR status:
- Release communication current:
- `sdd-review` verdict:
- Review record:
- `review.md` findings resolved:
- Planning updates resolved:
- Manual UI confirmation status:
- PR / merge state:
- Deferred scope accepted:
- Change moved to `docs/changes/closed/`:
