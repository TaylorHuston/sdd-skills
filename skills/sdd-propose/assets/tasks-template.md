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
- [ ] 1.3 Confirm each Story has an app-unique stable Story ID, local Requirement IDs, local Scenario IDs, Implemented By, Verified By, and Verification Gaps.

### 2. Implementation

- [ ] 2.1 Implement Requirements through BDD/TDD phases.
  - [ ] Story: STORY-ID - STORY TITLE
    - [ ] Requirement R1: REQUIREMENT TITLE
      - [ ] Scenario R1-S1: PRIMARY SCENARIO
      - [ ] Scenario R1-S2: FAILURE OR EMPTY STATE SCENARIO
- [ ] 2.2 Add short enabling phases only when needed before a Requirement can be tested or implemented.
- [ ] 2.3 Update Story-level Implemented By maps with current code locations.

### 3. Verification

- [ ] 3.1 Add or update focused verification for each implemented Requirement and Scenario.
- [ ] 3.2 Update Story-level Verified By maps with concrete evidence.

### 4. Review And Closeout

- [ ] 4.1 Update root `CHANGELOG.md` when `proposal.md` says changelog impact is required or TBD.
- [ ] 4.2 Run `sdd-review` as the local PR gate for Requirements, Scenarios, Epic truth, tests, security, docs, changelog, and branch readiness.
- [ ] 4.3 Record review outcome as a `review.md` path, a clean review recorded in this ledger, or an explicit user-approved review waiver.
- [ ] 4.4 Address any `review.md` findings or explicitly defer accepted non-blocking risks.
- [ ] 4.5 Record manual UI confirmation status as `not applicable`, `pending user`, `user confirmed`, or `accepted gap`.
- [ ] 4.6 Confirm closeout state has no contradictory Resume Here, checklist, review, manual confirmation, changelog, PR/merge, deferred-gap, or folder-location claims.
- [ ] 4.7 Create a PR or merge only after `sdd-review` is ready and the app branch policy plus user authorization allow it.
- [ ] 4.8 After review/PR/merge/acceptance is complete, move this change folder to `docs/changes/closed/`.

## Implementation Ledger

Record meaningful Requirement, Scenario, enabling, or delegated slices as they happen. Keep entries short.

| Date | Slice | Agent / Guidance | Files / Areas | Result | Commit / Ref |
|---|---|---|---|---|---|
| YYYY-MM-DD | STORY-ID R1/R1-S1 TBD | main or subagent TBD | TBD | TBD | TBD |

## Verification Ledger

Record proof as it happens.

| Date | Check | What It Proves | Result |
|---|---|---|---|
| YYYY-MM-DD | TBD | STORY-ID R1/R1-S1 TBD | TBD |

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
- Story/Requirement/Scenario IDs current:
- Implemented By maps current:
- Verified By maps current:
- Changelog current:
- `sdd-review` verdict:
- Review record:
- `review.md` findings resolved:
- Planning updates resolved:
- Manual UI confirmation status:
- PR / merge state:
- Deferred scope accepted:
- Change moved to `docs/changes/closed/`:
