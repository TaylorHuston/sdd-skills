---
status: in_review
space: sdd-skills
repositories:
  - sdd-skills
---
# Tasks: Centralize Change Storage

## Resume Here

- Last completed action: final remediation rechecks passed and `npm run check` completed with 255/255 tests plus packaged CLI help.
- Next action: run independent `/sdd-review` before any integration handoff.
- Active branch/ref: `update-skills` from `develop`; implementation remains uncommitted because no commit was requested.
- Expected dirty files: this Change folder, `docs/adrs/`, SDD-E001, CLI/config/schema/test surfaces, packaged skills/templates/workflow, README, and changelog.
- Known blocker outside branch review: the real user migration now passes identity and topology preflight but stops on the globally reused legacy Change ID `2026-07-14-ui-cleanup-and-reconciliation` across four Spaces. Those historical records require an explicit rename/reconciliation before installation adoption.

## Task Checklist

### 1. Planning Quality

- [x] 1.1 Classify the request as a scope expansion requiring replan.
- [x] 1.2 Confirm the central layout and migration policy with the user.
- [x] 1.3 Define global ownership, repository targeting, collision, migration, rollback, and verification obligations.
- [x] 1.4 Record the durable decision in `docs/adrs/2026-08-07-centralize-change-storage.md`.
- [x] 1.5 Validate the revised Change and transition it from `proposed` through `planned` to implementation.

### 2. CLI And Storage Contract

- [x] 2.1 Add focused failing tests for central create, metadata, global collisions, transition, close, status, and validation.
- [x] 2.2 Implement one central Change-store boundary rooted at `~/.sdd/changes`.
- [x] 2.3 Cut lifecycle commands, status, and validation over to the central record.
- [x] 2.4 Remove promotion and repository/idea Change-path behavior without aliases.
- [x] 2.5 Upgrade user, workspace-migration, and repository configuration shapes.

### 3. Automatic Update Migration

- [x] 3.1 Add focused failing tests for legacy discovery, identical consolidation, divergent/cross-Space collisions, destination conflicts, confinement, concurrent edits, rollback, and rerun idempotence.
- [x] 3.2 Preflight all legacy dated planned, active, and closed Change sources plus undated Change Brief files before writes.
- [x] 3.3 Migrate compatible Changes to the central store and undated briefs to fixed idea-local `change-briefs/` automatically during `sdd update`.
- [x] 3.4 Remove legacy sources only after central publication and config/install reconciliation are safe.
- [x] 3.5 Return deterministic human and JSON migration actions/errors.

### 4. Skills, Templates, And Public Contract

- [x] 4.1 Update shared Change templates and frontmatter ownership metadata.
- [x] 4.2 Update every path-bearing packaged skill and reference.
- [x] 4.3 Update the canonical workflow and remove promotion/dual-location doctrine.
- [x] 4.4 Update README, CLI help/examples, schemas, and changelog.
- [x] 4.5 Update workflow-contract tests so prose and templates remain executable package behavior.

### 5. Durable Truth

- [x] 5.1 Reconcile SDD-E001/S3 Requirements, Scenarios, implementation maps, gaps, and evidence.
- [x] 5.2 Reconcile SDD-E001/S6 workflow paths, implementation maps, gaps, and evidence.
- [x] 5.3 Record this bootstrap repository path as legacy migration input; physical adoption belongs to the installation update, not branch implementation.

### 6. Verification And Handoff

- [x] 6.1 Run focused lifecycle and migration tests through red/green/refactor slices.
- [x] 6.2 Run the isolated end-to-end update/lifecycle smoke scenario.
- [x] 6.3 Run `npm run check` and validate every changed skill.
- [x] 6.4 Run scoped structural validation and reconcile every implementation-created finding.
- [x] 6.5 Complete implementation self-check, update evidence, and transition to `in_review`.
- [ ] 6.6 Run `/sdd-review` before integration.

## Implementation Ledger

| Date | Slice | Agent / Guidance | Files / Areas | Result | Commit / Ref |
|---|---|---|---|---|---|
| 2026-08-07 | Branch setup | main; `/sdd-interactive` | Git branch; initial Change folder | `update-skills` created from clean `develop` | uncommitted |
| 2026-08-07 | Central storage replan | main; `/sdd-change --replan`; `/sdd-adr` | proposal, design, tasks, ADR | User decisions captured; implementation pending | uncommitted |
| 2026-08-07 | Central lifecycle cutover | main; `/sdd-apply` | Change store, create/transition/close/status/validate, configs/schemas, CLI, tests | One user-level record owns lifecycle; promotion and repository-local Change paths removed | uncommitted |
| 2026-08-07 | Fail-closed automatic migration | main; `/sdd-apply` | update migration, managed transaction, config upgrades, migration tests | Compatible legacy Changes and briefs migrate atomically; conflicts and drift fail before loss | uncommitted |
| 2026-08-07 | Workflow and durable truth reconciliation | main; packaged skill guidance | skills, templates, canonical workflow, README/site/changelog, SDD-E001 | All delivery workflows share the central record; Epic implementation and evidence maps reconciled | uncommitted |
| 2026-08-07 | Fresh-context review remediation | main; independent reviewers | journal authority/recovery, config validation/authority, status/validation projections, release handoff set | Seven review findings fixed with focused regressions; both bounded remediation rechecks passed | uncommitted |

## Verification Ledger

| Date | Check | Evidence Type | What It Proves | Result |
|---|---|---|---|---|
| 2026-08-07 | Initial scoped `sdd validate` against isolated equivalent user topology | structural validation | Bootstrap three-file Change shape before replan | Passed: 1 Change, 0 errors, 0 warnings |
| 2026-08-07 | Revised-plan and implementation structural validation | structural validation | Change plan plus SDD-E001 implementation/evidence maps | Passed: 1 Change and 1 Epic, 0 errors; three acknowledged large-Story warnings remain |
| 2026-08-07 | Focused centralization and review-remediation suites | automated tests | CLI lifecycle, migration, recovery, configuration authority/input safety, status projection, and packaged workflow contracts | Passed: all focused reruns completed with 0 failures |
| 2026-08-07 | `npm run check` after final review remediation | aggregate automated gate | Complete package behavior and packaged CLI help | Passed: 255/255 tests, 0 failures; help smoke passed |
| 2026-08-07 | Isolated legacy update → status → transition → close → update rerun | runtime smoke | Actual CLI migrates one legacy repository Change, exposes it globally, mutates it once, closes centrally, and reruns idempotently | Passed: migration required; status found ID; transition reached `in_review`; closed path existed; rerun planned 0 migration actions |
| 2026-08-07 | Isolated repository-only status and absolute-path scoped validation | runtime smoke / structural validation | A portable repository contract can project its central Change/Epic without a prior topology mapping, and `--repo <absolute-path>` selects it | Passed: status returned the active central Change and SDD-E001; validation returned 0 errors |

## Planning Updates

| Date | Discovery | Classification | Planning Updates | Next Apply Starting Point |
|---|---|---|---|---|
| 2026-08-07 | User requested every Change move to `~/.sdd/changes` and selected flat global IDs plus automatic update migration. | scope expansion | Replaced branch-only scope with central storage, lifecycle, metadata, migration, CLI, skill/template, docs, test, ADR, and SDD-E001 obligations. | `/sdd-apply`: write focused failing central lifecycle and migration tests before implementation. |

## Implementation Risk And Confirmation Matrix

| Requirement / Surface | End-State Invariant | Risk / Failure Mode | Check Or Confirmation Needed | Evidence / Finding | Status |
|---|---|---|---|---|---|
| SDD-E001/S3 central root | Every live Change exists once under the user root and cannot escape it. | symlink or traversal escapes; reserved `closed` misclassified as active | physical ancestor/confinement tests before and at commit | Central-root and symlink-escape tests passed | resolved |
| SDD-E001/S3 metadata | Space and repository IDs deterministically own each flat Change ID. | guessed ownership, missing repo identity, cross-Space collision | parser/schema tests and exact error assertions | Metadata, collision, and repository-selection tests passed | resolved |
| SDD-E001/S3 migration | Update either completes the compatible migration or preserves every source. | partial copy/removal, concurrent edit, rollback loss | injected failure and commit-time hash tests | Migration drift, rollback, and recovery tests passed | resolved |
| SDD-E001/S3 duplicate records | Identical copies consolidate; divergent copies never merge silently. | data loss or arbitrary winner | identical/different directory fixtures and no-write assertions | Identical consolidation and divergent no-write tests passed | resolved |
| Recovery journal authority and crash consistency | Recovery mutates only topology-authorized, identity-anchored paths; interrupted config replacement and cleanup remain recoverable. | journal tampering, repeated process exit, or false committed state overwrites/removes data, strands config, or deletes recovery artifacts | malicious-journal, repeated child-process termination, and honest/tampered committed-cleanup regressions | Independent recheck passed; focused suite proves verified restoration, resumable cleanup, and fail-closed content/source checks | resolved |
| SDD-E001/S6 workflow cutover | All skills/templates use the central record and no promotion/repo path survives. | dual truth or stale instructions | workflow-contract tests and targeted path inventory | Packaged workflow contracts and legacy-path inventory passed | resolved |
| User-local persistence | Automatic update is transparent before mutation. | routine update surprises or moves ambiguous work | dry-run plan and actionable conflict output | Dry-run and conflict tests passed; user selected automatic update | resolved |

## Pattern Parity Matrix

| Concern | Reference Location / Contract | New Location / Contract | Focused Proof | Intentional Divergence / Gap | Status |
|---|---|---|---|---|---|
| atomic staged mutation and rollback | prior lifecycle and managed-install mutation boundaries | central migration and single-record lifecycle | mutation/concurrency/rollback tests | promotion removed; safety invariants retained in central migration | resolved |
| deterministic human and JSON output | existing lifecycle/update commands | update migration actions and central paths | CLI tests for both formats | none | resolved |

## Boundary Contract Matrix

| Origin Condition | Domain Result / Invariant | Adapter / Transport Mapping | Client Behavior / Retryability | Exact Proof | Status |
|---|---|---|---|---|---|
| migration ownership/content conflict | no writes; typed SDD error with all conflicting paths | CLI JSON and human error | user reconciles then reruns update | focused divergent/cross-Space/destination/identity/symlink tests | resolved |
| missing or mismatched Change metadata | lifecycle command refuses the record | CLI JSON and human error | non-retryable until metadata/config repaired | focused metadata and command-routing tests | resolved |

## Stateful Transition Matrix

| Start State | Trigger / Interleaving | Durable Invariant | Observer / Recovery Behavior | Focused Test Or Runtime Observation | Result |
|---|---|---|---|---|---|
| legacy sources preflighted | source edited before migration commit | newer source is preserved; central destination is not published as authoritative | update reports concurrent change and leaves recoverable state | injected before-commit edit passed | passed |
| central active Change | status transition or close races with an edit | later content is never overwritten or removed | command aborts and reports the changed path | transition and close commit-time race tests passed | passed |
| partially committed migration | later config/install/source-removal failure | prior records and configs are restored or incomplete recovery is explicit | update returns affected paths and retains recoverable copies | injected multi-stage rollback passed | passed |
| completed migration | `sdd update` reruns | no duplicate copy, removal, or metadata drift | update reports no migration actions | isolated smoke rerun reported 0 actions | passed |
| config replacement journaled as `replacing` | process exits after live config is renamed to replacement backup | original config remains recoverable from the exact journaled sibling paths | next update restores original, removes safe replacement artifacts, then replans | child-process exit after backup regression passed | passed |

## Decision Fan-Out Ledger

| Date | Decision / Discovery | End-State Consequence | Affected Surfaces To Reconcile | Evidence / Artifact Updates | Status |
|---|---|---|---|---|---|
| 2026-08-07 | Flat global Change IDs | path no longer carries Space; metadata and global collision checks are mandatory | tasks frontmatter, parser, create, validate, status, docs, schemas, tests | implementation, tests, proposal/design/ADR, SDD-E001 | resolved |
| 2026-08-07 | Automatic migration during update | installer becomes a consequential record migration with dry-run/preflight/rollback obligations | update, mutation locks, config upgrades, CLI output, docs, changelog, tests | implementation, rollback tests, smoke, docs | resolved |
| 2026-08-07 | One canonical record | promotion and repository Change artifact keys are obsolete | CLI help/commands, configs/schemas, skills, templates, workflow, README, tests | clean cutover and path inventory | resolved |
| 2026-08-07 | User-local record ownership | repository PRs no longer contain Change ledgers | review/PR/release skills, docs, closeout language | workflow-contract tests and SDD-E001/S6 | resolved |

## Verification Environment

| Evidence Obligation | Required Setup / Safety Boundary | Needed For | Current Readiness | Result / Resolution |
|---|---|---|---|---|
| lifecycle and migration tests | disposable temporary user home, planning roots, repositories, and injected failures | SDD-E001/S3 | complete | Focused and aggregate tests passed |
| isolated end-to-end smoke | temporary user config and legacy sources; never real `~/.sdd` during proof | SDD-E001/S3/S6 | complete | Actual packaged CLI update/status/transition/close/rerun passed |
| skill validation | packaged workflow-contract tests, `quick_validate.py`, and aggregate package gate | SDD-E001/S6 | complete | Packaged contract tests, release skill validation, and `npm run check` passed |
| real user migration | actual `~/.sdd` and mapped repositories | installation adoption, not implementation proof | blocked by cross-Space legacy ID collision | Portable identities were added and stale retired worktree mappings removed; explicitly reconcile the four historical `2026-07-14-ui-cleanup-and-reconciliation` records before rerunning |

## Verification Scope Decision

- Project-defined aggregate command or authoritative constituent source: `npm run check` from `AGENTS.md` and `package.json`.
- Aggregate gate required before `in_review`: yes.
- Trigger or project-policy reason: package-wide CLI, schema, skill, workflow, migration, and contract change.
- Exact committed source candidate: none; no commit was authorized. The tested candidate is the current `update-skills` working tree.
- Freshness and cache treatment: Node test runner and CLI help ran fresh; 255 tests discovered and passed.
- Aggregate result and meaningful execution/count evidence: `npm run check` passed 255/255 tests with 0 failures, then packaged help passed.
- Post-gate evidence-only changes and affected checks rerun: only Change review/ledger reconciliation followed the aggregate gate; no executable package surfaces changed.
- Prospective integration gate required: yes; branch targets `develop` and spans shared contracts.
- Current target and prospective integration tree/ref: `develop`; uncommitted `update-skills` working tree.
- Integration-candidate result or reason source proof is reusable: pending independent `/sdd-review`; current working-tree package gate passed.
- Remote CI role: corroborating; no push or PR requested.

## Manual UI Confirmation

- Status: not applicable
- App URL / route: not applicable
- Required setup or test data: none
- Steps for the user: no UI surface changes.
- Expected result: not applicable.
- Feedback that would change artifacts: filesystem/CLI behavior feedback is classified through focused tests or an isolated smoke scenario.

## Visual Verification Matrix

Not applicable: the Change has no browser-visible or graphical surface.

## Blockers / Open Questions

- No implementation blocker remains.
- Real migration of the user's current `~/.sdd` is installation adoption, not branch proof. It fails closed on one legacy Change ID reused by `49th-floor`, `anthracitemd`, `coordinator`, and `lorecraft`; do not weaken collision preflight.
## Review Handoff Candidate

- Integration target / merge base: `develop`.
- Candidate source commit: none; no commit was authorized. Candidate is the current uncommitted working tree.
- Source differs from target when implementation changed: yes.
- Intended implementation fully committed: no; implementation is complete but remains uncommitted by policy.
- Unrelated dirty state preserved: yes; initial branch was clean and current repository dirt is this Change.
- Commit-sensitive generated-contract / diff / integration checks: package and focused gates pass against the working tree; rerun after any commit-producing handoff.
- Verification Scope Decision and aggregate candidate evidence: current; 255-test package gate and CLI help passed.
- Post-gate evidence-only changes classified and affected checks rerun: only Change review/ledger reconciliation followed the final aggregate gate.
- Prospective integration tree and required gate evidence: working-tree proof complete; immutable commit proof awaits an authorized commit and independent `/sdd-review`.
- Required risk, fan-out, environment, or verification rows still pending or blocked: none for implementation; real installation adoption is separately blocked.
- Pattern parity, boundary contract, and stateful transition matrices reconciled or not applicable with reason: reconciled.
- Capability authority, content-budget/provenance conservation, and filesystem mutation-order proof reconciled or not applicable: authorization and filesystem mutation-order proof are covered; content-budget/provenance is not applicable.
- Evidence claims falsified against exact tests, assertions, routes, or observations: completed; both independent remediation rechecks passed.
- Fresh-context failure-seeking passes completed: implementation/code, contract, security, recovery, and configuration-boundary passes completed.

## Closeout

- Change status: `in_review`; implementation, remediation, verification, and review-record reconciliation are complete.
- Epic files updated: yes; SDD-E001 S3 and S6 describe current implementation and verification.
- Story labels/references and Requirement/Scenario IDs current: yes; existing S3/S6 labels and IDs remain stable.
- Implemented By maps current: yes.
- One canonical implementation and verification map per Story: yes.
- Primary anchors inspected as behavior-owning definitions/registrations rather than incidental occurrences: yes.
- Scenario-mapped Verified By maps current: yes.
- Superseded earlier Epic truth reconciled: yes.
- README/current-state docs and active/closed Change claims reconciled: yes.
- ADR status: Accepted.
- Release communication current: yes; `CHANGELOG.md` records the central-storage and migration behavior.
- `sdd-review` verdict: pending independent integration review.
- Review record: `review.md`; `ready-for-review`.
- `review.md` findings resolved: yes; all seven findings have focused regressions and final independent rechecks.
- Planning updates resolved: selected contract is implemented and structurally valid.
- Implementation risk and confirmation rows resolved: yes.
- Pattern parity, boundary contract, and stateful transition rows resolved: yes.
- Capability authority, content-budget/provenance conservation, and filesystem mutation-order proof resolved: authorization and filesystem mutation-order proof resolved; other classes not applicable.
- Evidence-claim integrity checked: yes; independent failure-seeking and remediation rechecks complete.
- Decision fan-out reconciled: yes.
- Verification environment obligations resolved: implementation fixtures complete; real installation adoption separately blocked by explicit collision.
- Verification Scope Decision current and required candidate gates passed: current; working-tree package gate passed 255/255 tests plus CLI help.
- Immutable review handoff candidate: pending authorized commit.
- Tested integration candidate matches actual integrated tree, or rerun recorded: working tree tested; no commit/integration tree exists yet.
- Manual UI confirmation status: not applicable.
- Rendered UI verification status: not applicable.
- PR / merge state: none requested.
- Deferred scope accepted: shared stores, repository exports, backups, hosted coordination.
- Change moved to central `closed/`: no.
