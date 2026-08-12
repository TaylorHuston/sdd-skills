# Tasks: CHANGE TITLE

## Resume Here

- Last completed action: change artifacts drafted
- Next action: review change and tasks
- Active branches / refs by repository: unknown
- Expected dirty files: `<workspace>/.sdd/changes/yyyy-mm-dd-change-name/` plus repository-local implementation, Epic, ADR, test, and supporting-doc files grouped by target repository
- Known blockers: none identified yet

## Task Checklist

### 1. Planning Quality

- [ ] 1.1 Summarize the proposed scope boundary and confirm any unresolved decisions.
- [ ] 1.2 Challenge each proposed Story for user-path fit, Epic ownership, and unnecessary UI-task fragmentation.
- [ ] 1.3 Refine Requirements and Scenarios into observable behavior, including relevant happy path, empty state, failure mode, permission/validation case, recovery path, integration boundary, or security-sensitive condition.
- [ ] 1.4 Record assumptions, open questions, candidate Stories, and deferred scope instead of silently promoting uncertain behavior into accepted Requirements.
- [ ] 1.5 Confirm the planned `Verified By` sections can become scenario-mapped evidence indexes.
- [ ] 1.6 For UI-bearing changes with material experience uncertainty, complete `/sdd-design` or record why existing product conventions already make the direction implementation-ready.
- [ ] 1.7 For UI-bearing changes, define a proportional Visual Verification Matrix with affected surfaces, routes or fixtures, representative desktop/mobile viewports, relevant states/interactions, expected rendered behavior, and preferred tooling or fallback.
- [ ] 1.8 Seed the living risk, triggered boundary-contract applicability, decision fan-out, verification-environment, and Verification Scope Decision sections with end-state obligations already known. Include any known project-defined aggregate or prospective-integration gate. Do not turn them into an exhaustive implementation sequence; `/sdd-apply` must refine them from real implementation evidence.
- [ ] 1.9 Set `status: planned` only after the intent and technical-planning sections in `change.md`, tasks, Epic actions, and verification strategy are coherent and validated.

### 2. Epic Artifacts

- [ ] 2.1 Create or update the Epic directories named in `change.md` or a compatible existing `design.md`.
- [ ] 2.2 Create or update each Epic's `epic.md` file.
- [ ] 2.3 Confirm each Story has a stable Epic-scoped label or documented legacy Story ID, local Requirement IDs, local Scenario IDs, independent implementation/verification state, behavior-mapped Implemented By, Implementation Gaps, scenario-mapped Verified By, and Verification Gaps.
- [ ] 2.4 Check whether this change supersedes earlier Story, Requirement, Scenario, implementation ownership/gaps, or verification evidence/gaps; reconcile any stale truth.
- [ ] 2.5 Confirm each Story has one authoritative current Implemented By map and one authoritative current Verified By map; consolidate competing prior/detailed/legacy maps into them.

### 3. Architecture Decisions

- [ ] 3.1 Confirm `change.md` delegates viable technical options to `/sdd-adr` or records why only one path is reasonable.
- [ ] 3.2 Create or update ADRs named in `change.md` when the change makes durable architecture decisions.
- [ ] 3.3 Confirm ADR status is accurate: proposed / accepted / superseded / not applicable.

### 4. Implementation

- [ ] 4.1 Implement Requirements through adaptive BDD/TDD phases, selecting the next coherent slice from current evidence rather than freezing the order during planning.
  - [ ] Story: EPIC-ID/S1 - STORY TITLE
    - [ ] Requirement R1: REQUIREMENT TITLE
      - [ ] Scenario R1-S1: PRIMARY SCENARIO
      - [ ] Scenario R1-S2: FAILURE OR EMPTY STATE SCENARIO
- [ ] 4.2 Add short enabling phases only when needed before a Requirement can be tested or implemented.
- [ ] 4.3 Re-evaluate and update applicable end-state risks, decision fan-out, and evidence-environment readiness as each slice reveals implementation reality.
- [ ] 4.4 When a new adapter, client, route, workspace, worker, migration, command, or similar surface parallels an established implementation, complete the applicable Pattern Parity Matrix rows and explain intentional divergences.
- [ ] 4.5 When an important typed result, error, status, permission, or retry decision crosses a service, plugin/capability, adapter, transport, or client boundary, complete the applicable Boundary Contract Matrix rows.
- [ ] 4.6 When the slice owns editable, autosaving, cached, routed, asynchronous, durable, or identity-sensitive state, complete the applicable Stateful Transition Matrix rows, including relevant concurrency, cancellation, stale-completion, remount, restart, and recovery interleavings.
- [ ] 4.7 Update Story-level Implemented By maps with behavior-owning definitions, registrations, or configuration. Use narrower Requirement/Scenario rows for distinct governing boundaries; do not accept imports, call sites, incidental handlers, or already-cited files as semantic coverage.
- [ ] 4.8 Commit every completed, verified, reconciled phase before beginning the next unless commits are explicitly disabled or prohibited.

### 5. Verification

- [ ] 5.1 Add or update focused verification for each implemented Requirement and Scenario.
- [ ] 5.2 For automated evidence, inspect the cited source and record `path#exact test title or stable named test anchor` plus the assertion, route, selector, injected failure, or observation that proves the Scenario. Reject generic framework anchors such as `#it(`, `#test(`, or `#describe(`.
- [ ] 5.3 Update Story-level Verified By maps with scenario-mapped evidence, not chronological command logs. Do not aggregate Scenarios unless the named test explicitly exercises each one.
- [ ] 5.4 Label evidence types where useful: focused automated test, broad supporting gate, deterministic E2E, live-provider playtest, manual UI confirmation, or debug/log inspection.
- [ ] 5.5 Verify ADR assumptions or record the remaining decision risk.
- [ ] 5.6 Confirm every required database, migration, browser, provider, generated-contract, platform, or production-path environment actually ran before treating its behavior as verified.
- [ ] 5.7 Reopen any checklist or verification claim whose cited proof is missing, too broad, skipped, undiscovered, or weaker than the behavior claimed.
- [ ] 5.8 Resolve the Verification Scope Decision and run every required aggregate candidate gate freshly on the exact final committed candidate; record meaningful execution/count and cache/freshness evidence.
- [ ] 5.9 Run scoped `sdd validate` and resolve deterministic artifact errors before handoff.

### 6. Review And Closeout

- [ ] 6.1 Update the project-defined release communication when `change.md` says release-communication impact is required or TBD.
- [ ] 6.2 Run `sdd-review` as the local PR gate across every target repository for Requirements, Scenarios, Epic truth, tests, security, docs, release communication, ADR consistency, and branch readiness.
- [ ] 6.3 Record each target repository's review outcome in the one central `review.md`, or record a clean review in this ledger or an explicit user-approved review waiver.
- [ ] 6.4 Address any `review.md` findings or explicitly defer accepted non-blocking risks.
- [ ] 6.5 Record manual UI confirmation status as `not applicable`, `pending user`, `user confirmed`, or `accepted gap`.
- [ ] 6.6 Confirm change/tasks/review artifacts and any compatible existing design do not still claim completed work is not implemented, not verified, pending, or accepted under obsolete manual status vocabulary.
- [ ] 6.7 Confirm machine-readable Change status agrees with Resume Here, checklist, review, manual confirmation, release communication, ADR, PR/merge, deferred-gap, and folder-location claims.
- [ ] 6.8 Keep `status: in_review` while independent review and closeout gates are underway.
- [ ] 6.9 Before `in_review`, record an immutable candidate commit for every target repository, confirm intended implementation is committed, pass commit-sensitive contract/diff checks and every required aggregate candidate gate on each exact candidate, and leave no required risk, fan-out, environment, or verification obligation silently pending.
- [ ] 6.10 Before integration or closeout, resolve whether each repository's current target produces a materially different prospective integration tree. When required, run the aggregate gate against that exact tree; after integration, confirm the actual tree matches or rerun before closing.
- [ ] 6.11 Create a PR or merge in a target repository only after its `sdd-review` result is ready and that repository's branch policy plus user authorization allow it.
- [ ] 6.12 After every target repository's review/PR/merge/acceptance and required integration-candidate proof are complete and `status: in_review` remains accurate, run `sdd change close <space-id> <change-id>` once instead of writing a `closed` status.

## Implementation Ledger

Record meaningful Requirement, Scenario, enabling, or delegated slices as they happen. Keep entries short.

| Date | Repository | Slice | Agent / Guidance | Files / Areas | Result | Commit / Ref |
|---|---|---|---|---|---|---|
| YYYY-MM-DD | repository-id | EPIC-ID/S1 R1/R1-S1 TBD | main or subagent TBD | TBD | TBD | TBD |

## Verification Ledger

Record proof as it happens. Keep chronological command output here; summarize only durable scenario-mapped evidence into Epic `Verified By`. Do not blur deterministic E2E, live-provider playtests, manual UI confirmation, broad gates, and debug/log inspection into one evidence bucket.

| Date | Repository | Check | Evidence Type | What It Proves | Result |
|---|---|---|---|---|---|
| YYYY-MM-DD | repository-id | TBD | focused automated test / aggregate candidate gate / integration-candidate gate / broad supporting gate / deterministic E2E / live-provider playtest / manual UI confirmation / debug-log inspection | EPIC-ID/S1 R1/R1-S1 or candidate scope | TBD |

## Manual Feedback

Record the user's manual testing feedback after implementation starts.

| Date | Feedback | Classification | Action / Artifact Updates | Status |
|---|---|---|---|---|
| YYYY-MM-DD | TBD | defect / verification gap / artifact drift / requirement refinement / scope expansion / product drift | TBD | open |

## Planning Updates

Record `/sdd-change` planning updates when implementation or feedback changes the accepted plan.

| Date | Discovery | Classification | Planning Updates | Next Apply Starting Point |
|---|---|---|---|---|
| YYYY-MM-DD | TBD | in-scope refinement / scope expansion / product drift / Epic ownership change / technical constraint / follow-up change | change.md / tasks.md | `/sdd-apply` TBD |

## Design Updates

Record `/sdd-design --revise` work when implementation, comparison, review, or manual feedback requires another experience-design pass without changing accepted behavior.

| Date | Feedback / Discovery | Classification | Reference / Target | Preserve / Change / Non-Goals | Artifact Updates | Next Apply Starting Point |
|---|---|---|---|---|---|---|
| YYYY-MM-DD | TBD | experience refinement / experience defect / accessibility correction / responsive correction | TBD | TBD | change.md / tasks.md | `/sdd-apply` TBD |

## Implementation Risk And Confirmation Matrix

This is a living end-state and evidence surface, not an upfront implementation script. Planning seeds known obligations; `/sdd-apply` must add, remove, split, and refine rows as real code, failures, decisions, and relevant review history reveal the actual risks.

| Requirement / Surface | End-State Invariant | Risk / Failure Mode | Check Or Confirmation Needed | Evidence / Finding | Status |
|---|---|---|---|---|---|
| EPIC-ID/S1 R1 TBD | TBD | authoritative refresh / async write / owner or Type boundary / untrusted publication / migration or existing data / configuration fan-out / recovery / generated contract | TBD | TBD | known / investigating / proved / accepted gap / blocked / not applicable |

## Pattern Parity Matrix

Required when implementation adds a surface parallel to an established adapter, client, route, workspace, worker, migration, command, or other sibling pattern. Compare behavior and evidence, not only source shape. If not applicable, record why.

| Concern | Reference Location / Contract | New Location / Contract | Focused Proof | Intentional Divergence / Gap | Status |
|---|---|---|---|---|---|
| auth/session/CSRF/retry/timeout/error/recovery/navigation/state/visual token as applicable | TBD | TBD | exact test title, assertion, route, injected failure, or observation | none / reason | pending / matched / intentional divergence / accepted gap / blocked / not applicable |

## Boundary Contract Matrix

Required when an important typed result, error, status, permission, or retry decision crosses a service, plugin/capability, adapter, transport, or client boundary. Preserve distinctions that downstream behavior needs. If not applicable, record why.

| Origin Condition | Domain Result / Invariant | Adapter / Transport Mapping | Client Behavior / Retryability | Exact Proof | Status |
|---|---|---|---|---|---|
| TBD | TBD | service / plugin / capability / HTTP / IPC / client mapping | visible result, status, retry, recovery, or terminal behavior | exact test title, injected condition, assertion, or observation | pending / preserved / accepted gap / blocked / not applicable |

## Stateful Transition Matrix

Required when implementation owns editable, autosaving, cached, routed, asynchronous, durable, or identity-sensitive state. Cover applicable edges and interleavings such as entity changes, pending writes plus navigation, concurrent start before/after the first await, cancel/disconnect during pending work, stale completion after replacement, terminal retry, mounted refresh, remount, process restart, durable records whose identifier never reached the client, conflict/failure recovery, return context, browser history, session expiry/sign-out, authoritative refresh, and slow or hung requests. If recovery depends on an operation identifier, verify when identity is reserved. If not applicable, record why.

| Start State | Trigger / Interleaving | Durable Invariant | Observer / Recovery Behavior | Focused Test Or Runtime Observation | Result |
|---|---|---|---|---|---|
| TBD | concurrent start / cancel then late completion / replacement / retry / remount / restart / entity A to B / slow-hung request | TBD | client, worker, mounted consumer, restart recovery, or cleanup behavior | exact test title, network control, restart fixture, trace, route, or observation | pending / passed / accepted gap / blocked / not applicable |

## Decision Fan-Out Ledger

Record implementation discoveries, user decisions, replans, ADR changes, defaults, security rules, contract changes, or experience decisions that alter the accepted end state or its consequences. Inspect affected surfaces as they become known; do not require planning to predict them all.

| Date | Decision / Discovery | End-State Consequence | Affected Surfaces To Reconcile | Evidence / Artifact Updates | Status |
|---|---|---|---|---|---|
| YYYY-MM-DD | TBD | TBD | Requirements / Epics / ADR / code / config / env example / migration / API or generated client / tests / UI / docs / Idea guidance / release communication | TBD | open / reconciled / accepted gap / blocked |

## Verification Environment

Track environment readiness continuously. Missing setup may allow unrelated safe work to continue, but the affected behavior cannot be marked verified or handed to review until the evidence runs or the gap is explicitly accepted where permitted.

| Evidence Obligation | Required Setup / Safety Boundary | Needed For | Current Readiness | Result / Resolution |
|---|---|---|---|---|
| TBD | disposable database / existing-data fixture / browser runtime / provider / account / platform / committed generated-contract comparison | EPIC-ID/S1 R1/R1-S1 TBD | ready / pending / blocked / not applicable | TBD |

## Verification Scope Decision

Keep focused behavior proof distinct from aggregate and integration-candidate proof. Resolve command names and required constituents from project guidance rather than imposing one universal stack.

- Project-defined aggregate commands or authoritative constituent sources by repository:
- Aggregate gates required before `in_review`: yes / no / pending, by repository
- Trigger or project-policy reasons:
- Exact committed source candidates by repository:
- Freshness and cache treatment:
- Aggregate results and meaningful execution/count evidence:
- Post-gate evidence-record-only changes and affected checks rerun:
- Prospective integration gates required: yes / no / pending, by repository
- Current targets and prospective integration trees/refs:
- Integration-candidate results or reasons source proof is reusable:
- Remote CI role: required / corroborating / unavailable / not applicable

Repository-key every integration handoff. Repeat one row per target repository; never combine tree identity or rerun evidence across repositories.

| Repository ID | Tested Integration Tree / Ref | Actual Integrated Tree / Ref | Match | Required Aggregate Rerun / Evidence | Result |
|---|---|---|---|---|---|
| repository-id | TBD | pending / TBD | yes / no / pending | not required / exact command and result / pending | pass / findings / blocked / pending |

## Manual UI Confirmation

- Status: pending user / user confirmed / accepted gap / not applicable
- App URL / route:
- Required setup or test data:
- Steps for the user:
- Expected result:
- Feedback that would change artifacts:

## Visual Verification Matrix

Required for UI-bearing changes. If not applicable, record why.

| Surface / Route or Fixture | Viewport | State / Interaction | Expected Rendered Behavior | Tool / Setup | Inspected Evidence | Console / Network | Result |
|---|---|---|---|---|---|---|---|
| TBD | desktop / mobile | default / loading / empty / error / populated / long content / focus / selected / disabled / interaction | TBD | project browser/screenshot tooling / runtime browser / rendered preview or fixture / manual browser capture | screenshot, trace, or direct observation | clean / findings / not applicable | pending |

## Blockers / Open Questions

- None identified yet.

## Review Handoff Candidate

- Repository-specific integration targets / merge bases:
- Candidate source commits by repository:
- Source differs from target where implementation changed: yes / no / not applicable
- Intended implementation fully committed in every target repository: yes / no / commits disabled with reason
- Unrelated dirty state preserved in every target repository:
- Commit-sensitive generated-contract / diff / integration checks:
- Verification Scope Decision and aggregate candidate evidence by repository:
- Post-gate evidence-only changes classified and affected checks rerun:
- Prospective integration trees and required gate evidence by repository:
- Required risk, fan-out, environment, or verification rows still pending or blocked:
- Pattern parity, boundary contract, and stateful transition matrices reconciled or not applicable with reason:
- Capability authority, content-budget/provenance conservation, and filesystem mutation-order proof reconciled or not applicable:
- Evidence claims falsified against exact tests, assertions, routes, or observations:
- Fresh-context failure-seeking passes completed:

## Closeout

- Change status:
- Epic files updated:
- Story labels/references and Requirement/Scenario IDs current:
- Implemented By maps current:
- One canonical implementation and verification map per Story:
- Primary anchors inspected as behavior-owning definitions/registrations rather than incidental occurrences:
- Scenario-mapped Verified By maps current:
- Superseded earlier Epic truth reconciled:
- README/current-state docs and central active/closed Change claims reconciled:
- ADR status:
- Release communication current:
- `sdd-review` verdict:
- Review record:
- `review.md` findings resolved:
- Planning updates resolved:
- Implementation risk and confirmation rows resolved:
- Pattern parity, boundary contract, and stateful transition rows resolved:
- Capability authority, content-budget/provenance conservation, and filesystem mutation-order proof resolved:
- Evidence-claim integrity checked:
- Decision fan-out reconciled:
- Verification environment obligations resolved:
- Verification Scope Decision current and required candidate gates passed:
- Immutable review handoff candidate:
- PR / merge state by repository:
- Tested integration tree vs actual integrated tree and required aggregate rerun evidence by repository:
- Manual UI confirmation status:
- Rendered UI verification status:
- Deferred scope accepted:
- Change moved to `<workspace>/.sdd/changes/closed/yyyy-mm-dd-change-name/`:
