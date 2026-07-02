# Tasks: CHANGE TITLE

## Resume Here

- Current state: proposed
- Last completed action: change artifacts drafted
- Next action: review proposal, design, and tasks
- Active branch/ref: unknown
- Expected dirty files: `docs/changes/yyyy-mm-dd-change-name/`
- Known blockers: none identified yet

## Task Checklist

### 1. Epic Artifacts

- [ ] 1.1 Create or update the Epic directories named in `proposal.md` and `design.md`.
- [ ] 1.2 Create or update each Epic's `epic.md` file.
- [ ] 1.3 Confirm each Story has a stable Epic-scoped label or documented legacy Story ID, local Requirement IDs, local Scenario IDs, Implemented By, Verified By, and Verification Gaps.
- [ ] 1.4 Check whether this change supersedes earlier Story, Requirement, Scenario, Verified By, or Verification Gaps wording; reconcile any stale truth.

### 2. Architecture Decisions

- [ ] 2.1 Confirm `design.md` compares viable technical options or records why only one path is reasonable.
- [ ] 2.2 Create or update ADRs named in `design.md` when the change makes durable architecture decisions.
- [ ] 2.3 Confirm ADR status is accurate: proposed / accepted / superseded / not applicable.

### 3. Implementation

- [ ] 3.1 Implement Requirements through BDD/TDD phases.
  - [ ] Story: EPIC-ID/S1 - STORY TITLE
    - [ ] Requirement R1: REQUIREMENT TITLE
      - [ ] Scenario R1-S1: PRIMARY SCENARIO
      - [ ] Scenario R1-S2: FAILURE OR EMPTY STATE SCENARIO
- [ ] 3.2 Add short enabling phases only when needed before a Requirement can be tested or implemented.
- [ ] 3.3 Update Story-level Implemented By maps with current code locations.

### 4. Verification

- [ ] 4.1 Add or update focused verification for each implemented Requirement and Scenario.
- [ ] 4.2 Update Story-level Verified By maps with scenario-mapped evidence, not chronological command logs.
- [ ] 4.3 Label evidence types where useful: focused automated test, broad supporting gate, deterministic E2E, live-provider playtest, manual UI confirmation, or debug/log inspection.
- [ ] 4.4 Verify ADR assumptions or record the remaining decision risk.

### 5. Review And Closeout

- [ ] 5.1 Update root `CHANGELOG.md` when `proposal.md` says changelog impact is required or TBD.
- [ ] 5.2 Run `sdd-review` as the local PR gate for Requirements, Scenarios, Epic truth, tests, security, docs, changelog, ADR consistency, and branch readiness.
- [ ] 5.3 Record review outcome as a `review.md` path, a clean review recorded in this ledger, or an explicit user-approved review waiver.
- [ ] 5.4 Address any `review.md` findings or explicitly defer accepted non-blocking risks.
- [ ] 5.5 Record manual UI confirmation status as `not applicable`, `pending user`, `user confirmed`, or `accepted gap`.
- [ ] 5.6 Confirm proposal/design/tasks/review artifacts do not still claim completed work is not implemented, not verified, pending, or accepted under obsolete manual status vocabulary.
- [ ] 5.7 Confirm closeout state has no contradictory Resume Here, checklist, review, manual confirmation, changelog, ADR, PR/merge, deferred-gap, or folder-location claims.
- [ ] 5.8 Create a PR or merge only after `sdd-review` is ready and the app branch policy plus user authorization allow it.
- [ ] 5.9 After review/PR/merge/acceptance is complete, move this change folder to `docs/changes/closed/`.

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

Record `/sdd-propose --replan` updates when implementation or feedback discovers planning-level requirements.

| Date | Discovery | Classification | Planning Updates | Next Apply Starting Point |
|---|---|---|---|---|
| YYYY-MM-DD | TBD | in-scope refinement / scope expansion / product drift / Epic ownership change / technical constraint / follow-up change | proposal.md / design.md / tasks.md | `/sdd-apply` TBD |

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

- Epic files updated:
- Story labels/references and Requirement/Scenario IDs current:
- Implemented By maps current:
- Scenario-mapped Verified By maps current:
- Superseded earlier Epic truth reconciled:
- ADR status:
- Changelog current:
- `sdd-review` verdict:
- Review record:
- `review.md` findings resolved:
- Planning updates resolved:
- Manual UI confirmation status:
- PR / merge state:
- Deferred scope accepted:
- Change moved to `docs/changes/closed/`:
