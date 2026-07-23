---
status: in_progress
---
# Tasks: Harden Audit Report Integrity

## Resume Here

- Last completed action: `/sdd-apply` implemented and verified the S1 report-integrity and S5 immutable Git-baseline slices and reconciled their durable Epic truth.
- Next action: commit the isolated S1 and S5 phases, then reconcile shipped workflow behavior into S6.
- Active branch/ref: `develop@eba9e5d` after the committed replan ledger; `origin/develop@a670fa28ebfd4df175217b60a74d92cfee520c74`.
- Expected dirty files: this Change's `proposal.md`, `design.md`, `tasks.md`, and existing user work in `CHANGELOG.md` plus `site/index.html`, `site/site.js`, and `site/styles.css`.
- Known blockers: implementation and evidence findings remain open; planning has no unresolved decision.

## Task Checklist

### 1. Planning Quality

- [x] 1.1 Reconcile the cumulative review into one explicit scope boundary.
- [x] 1.2 Challenge Story ownership and preserve S1/S5 while adding S6/S7 for distinct durable outcomes.
- [x] 1.3 Define observable report, workflow, Git-safety, and public-guide Requirements/Scenarios.
- [x] 1.4 Separate this Change's S1/S5/S6/S7 work from S2/S3 remediation owned by `2026-07-20-harden-cli-trust-boundaries`.
- [x] 1.5 Compare Story-ownership options and select the smallest coherent split.
- [x] 1.6 Seed risk, fan-out, environment, aggregate, integration, manual-acceptance, and visual-verification obligations.
- [x] 1.7 Transition `proposed -> planned` after scoped validation confirms the revised artifact set.

### 2. Epic Artifacts

- [x] 2.1 Update `SDD-E001/S1 R4` with missing-schema, canonical-gate, Epic-scope, and complete lineage Scenarios.
- [x] 2.2 Update `SDD-E001/S5` with safe immutable Git-baseline behavior and explicit validator/template boundary ownership.
- [ ] 2.3 Add `SDD-E001/S6` Reliable Workflow Execution with independently derived implementation and verification state.
- [ ] 2.4 Add `SDD-E001/S7` Accessible Public Methodology Reference with independently derived implementation and verification state.
- [ ] 2.5 Reconcile Story Index, current Outcomes, one canonical map per Story, exact primary anchors, evidence, and gaps without claiming proof that has not run.
- [ ] 2.6 Reconcile both active Change ledgers and review records to the same final candidate while preserving single finding ownership.

### 3. Implementation

- [x] 3.1 `SDD-E001/S1 R4`: make the validator and real packaged report template one coherent canonical-gate contract.
- [x] 3.2 `SDD-E001/S1 R4`: reject a recognized report kind with a missing schema and require current-Epic/repository proof for aligned reports.
- [x] 3.3 `SDD-E001/S1 R4-S2`: add exact self-referential and non-versioned predecessor behavior/proof.
- [x] 3.4 `SDD-E001/S5`: resolve orphan-audit baselines to immutable commits with option barriers and bounded subprocesses.
- [ ] 3.5 `SDD-E001/S6`: reconcile the shipped Planning, Apply, Review, Design, and Interactive workflow contracts and their mirrored templates/doctrine.
- [ ] 3.6 `SDD-E001/S7`: reconcile public-guide content, navigation, copy fallback, accessibility, responsive composition, and Steel presentation.
- [ ] 3.7 Keep S2/S3 topology, initialization, physical-containment, and recovery remediation in the earlier active Change; consume its verified result rather than duplicate code.
- [ ] 3.8 Commit each completed verified and artifact-reconciled Requirement/Scenario phase when files can be isolated safely.

### 4. Verification

- [x] 4.1 Add failing-first tests for each current report/Git finding and inspect the exact assertion and discovery path.
- [ ] 4.2 Add or refine exact package contract tests for every S5/S6 Scenario; do not use string presence as proof of behavior it does not exercise.
- [ ] 4.3 Add deterministic S7 checks where practical, then directly render and inspect the Visual Verification Matrix.
- [ ] 4.4 Run `npm run check`, dependency audit, package dry run, changed-skill validation, template parity, diff checks, `sdd doctor`, scoped validation, and changed-surface reverse traceability.
- [ ] 4.5 Run the required aggregate gate freshly against the exact final committed source candidate and record meaningful test counts.
- [ ] 4.6 Build the prospective `develop -> main` integration tree and rerun the aggregate gate there if it differs materially from the source candidate.
- [ ] 4.7 Keep S1/S5/S6/S7 verification partial or unverified until exact scenario proof and current rendered evidence exist.

### 5. Review And Closeout

- [ ] 5.1 Reconcile README, canonical doctrine, templates, changelog, public guide, both active Changes, and current review findings.
- [ ] 5.2 Refresh managed skills only through `sdd update`, then verify with `sdd doctor`.
- [ ] 5.3 Record one immutable cumulative review-handoff candidate shared by both active Changes.
- [ ] 5.4 Transition to `in_review` only after implementation, evidence, Epic truth, aggregate/integration gates, and rendered verification are current.
- [ ] 5.5 Run a fresh independent `/sdd-review`; do not reuse the `c477e4a` verdict after material remediation.
- [ ] 5.6 Keep manual UI confirmation `pending user` until the owner confirms the exact final Steel candidate.
- [ ] 5.7 Do not push, create a PR, merge, close, tag, publish, or release without the owning workflow and current authorization.

## Implementation Ledger

| Date | Slice | Agent / Guidance | Files / Areas | Result | Commit / Ref |
|---|---|---|---|---|---|
| 2026-07-22 | Initial S1/S5 implementation | main; TDD and package guidance | validator, Epic Verify, PR, Release, templates, docs | Implemented and committed before cumulative review. | `494b121`, `ee1fa1b`, `a670fa2` |
| 2026-07-22 | Independent cumulative review | main plus artifact, code/security, and UI reviewers | full `v0.11.0` candidate | Three blocking and seven required findings consolidated. | reviewed snapshot `c477e4a`; record `4ff9240` |
| 2026-07-23 | Replan | main; `/sdd-change --replan` | proposal, design, tasks, review log | Ownership split revised to S1/S5/S6/S7; S2/S3 boundary retained; Change transitioned to `in_progress`. | `3ec27ab` |
| 2026-07-23 | S1 report integrity | main plus bounded report-contract agent; TDD | report validator, CLI tests, S1 Epic truth | Canonical template gates, recognized missing-schema reports, exact scoped proof, and complete lineage are implemented and verified. | pending isolated phase commit |
| 2026-07-23 | S5 immutable Git baseline | bounded code/security agent; TDD | orphan-audit script/tests, S5 Epic truth | Option-like baselines are rejected without side effects; immutable commits and bounded Git subprocesses govern changed-surface audits. | pending isolated phase commit |

## Verification Ledger

| Date | Check | Evidence Type | What It Proves | Result |
|---|---|---|---|---|
| 2026-07-22 | `npm run check` | aggregate candidate gate | Existing suite and CLI help on reviewed snapshot. | passed; 179 tests, but adversarial gaps remained |
| 2026-07-22 | scoped SDD validation after safe review fixes | deterministic artifact gate | Existing Change/Epic structure and anchors. | passed; 0 errors, 0 warnings |
| 2026-07-22 | changed-surface orphan audit | reverse traceability | Existing mapped refs resolve; broader workflow/site ownership is incomplete. | findings; 22 unowned source candidates |
| 2026-07-22 | Chromium desktop/tablet/mobile matrix | deterministic rendered UI | Current Steel one-pager layout, focus, navigation, copy, overflow, reduced motion, contrast, console/network. | passed after safe fixes; manual acceptance pending |
| 2026-07-22 | temporary report/topology/init/path/Git probes | adversarial falsification | Current review defects reproduce outside the green suite. | findings |
| 2026-07-23 | `node --test test/cli.test.js` | full CLI suite | Report/template parity, missing schema, exact Epic/repository scope, lineage, and existing CLI behavior. | passed; 153 tests |
| 2026-07-23 | `node --test test/orphan-audit.test.js` | full orphan-audit suite | Immutable baseline resolution, option-injection containment, bounded Git execution, and existing audit behavior. | passed; 7 tests |
| 2026-07-23 | syntax/compile and diff checks | deterministic source gate | Changed JavaScript and Python parse and the current patch has no whitespace errors. | passed |

## Manual Feedback

| Date | Feedback | Classification | Action / Artifact Updates | Status |
|---|---|---|---|---|
| 2026-07-22 | Stories must be durable behavior records; behavior changes update them rather than creating task-like replacements. | requirement refinement | S1/S5 retained; S6/S7 added only for distinct developer and public-reader outcomes. | reconciled in plan |
| 2026-07-22 | The one-pager should use Steel and read as documentation rather than a SaaS landing page. | experience refinement | S7 contract and Visual Verification Matrix preserve the confirmed direction. | direction confirmed; exact candidate pending |

## Planning Updates

| Date | Discovery | Classification | Planning Updates | Next Apply Starting Point |
|---|---|---|---|---|
| 2026-07-23 | Cumulative review found shipped workflow/site behavior outside S1/S5 plus missing report/Git boundary proof. | Epic ownership change and in-scope refinement | Expanded proposal/design; planned S6/S7; refined S1/S5; separated earlier S2/S3 Change ownership; rebuilt risk, scope, environment, handoff, and visual records. | `/sdd-apply` at `SDD-E001/S1 R4` after confirming cross-Change ownership |

## Design Updates

| Date | Feedback / Discovery | Classification | Reference / Target | Preserve / Change / Non-Goals | Artifact Updates | Next Apply Starting Point |
|---|---|---|---|---|---|---|
| 2026-07-23 | Review confirmed the Steel direction and found three safe source/typography defects. | accessibility and responsive correction | current `site/` candidate | Preserve documentation IA/identity; correct semantics, canonical IDs, wrapping; no redesign. | `design.md`, `tasks.md`; safe fixes already in working tree | `/sdd-apply` S7 evidence reconciliation |

## Implementation Risk And Confirmation Matrix

| Requirement / Surface | End-State Invariant | Risk / Failure Mode | Check Or Confirmation Needed | Evidence / Finding | Status |
|---|---|---|---|---|---|
| S1/R4 report contract | A report completed from the shipped template can be validated by the runtime using one canonical gate set. | Template/runtime drift makes `aligned` impossible or falsely permissive. | Template-derived fixture plus exact gate parity and contradictory-result tests. | Real 18-gate template fixture and full CLI suite pass. | proved |
| S1/R4 report identity/evidence | Every recognized report is validated and only current-Epic proof can certify it. | Missing schema hides the report; another Epic's checks certify it. | Missing-schema and wrong-Epic negative fixtures. | Exact missing-schema, wrong-Epic, and prefix-confusable wrong-repository tests pass. | proved |
| S1/R4 lineage | Predecessors are versioned immutable reports in the same Epic review directory. | Self or non-versioned targets satisfy an overstated Scenario. | Exact self/non-versioned tests plus evidence update. | Exact self, non-versioned, missing, and absolute predecessor tests pass. | proved |
| S5 immutable Git selection | User-controlled baseline cannot become a Git option or hang the workflow. | Option injection writes outside the repo; subprocess never returns. | `rev-parse --verify --end-of-options`, immutable commit, option barrier, timeout probes. | Exact no-side-effect option-injection and fake-Git timeout tests pass. | proved |
| S6 workflow contracts | Planning/Apply/Review guidance, templates, doctrine, and tests agree on end-state behavior. | Broad string tests pass while one workflow stops early or omits a required final report. | Exact package contract assertions plus semantic source inspection. | Review found ownership/evidence gaps across shipped skills. | known |
| S7 public guide | Current source remains readable, navigable, accessible, and truthful across representative states. | Source checks miss invalid DOM, interaction fallback, overflow, or visual regression. | Visual Verification Matrix plus static DOM/ID/fragment checks. | Initial review found and safely fixed three issues. | known |
| Cross-Change integration | Every defect has one owner and both ledgers identify the same final candidate. | Duplicate fixes, stale watermarks, or incompatible Epic updates. | Compare both task/review records before each handoff. | Two active Changes share the cumulative release candidate. | known |

## Pattern Parity Matrix

| Concern | Reference Location / Contract | New Location / Contract | Focused Proof | Intentional Divergence / Gap | Status |
|---|---|---|---|---|---|
| Versioned report runtime/template parity | `src/epic-verify-report.js#CANONICAL_GATES` | canonical and packaged Epic Verify report templates | template-derived aligned-report test | none permitted | matched |
| Workflow final-report parity | single review final report | `--until-ready` final report | packaged Review contract test plus rereview output | iteration history may be cumulative; final fields may not diverge | pending |
| Rendered navigation and interaction | desktop Steel documentation shell | tablet/mobile navigation and copy fallback | browser matrix with keyboard and clipboard-failure states | composition may collapse responsively without losing semantics | pending |

## Boundary Contract Matrix

| Origin Condition | Domain Result / Invariant | Adapter / Transport Mapping | Client Behavior / Retryability | Exact Proof | Status |
|---|---|---|---|---|---|
| Report kind recognized but schema absent | deterministic invalid-report finding | validator JSON finding | caller can fix the report; it never disappears | missing-schema focused test | proved |
| Aligned report cites another Epic | scoped proof rejected | validator report finding | caller reruns validation/orphan audit for the current Epic | wrong-Epic and wrong-repository focused tests | proved |
| Git baseline starts with option syntax | ref rejected before diff | orphan-audit structured failure/exit | no external write; caller supplies a valid ref | option-injection and valid-ref tests | proved |
| Git subprocess exceeds bound | deterministic timeout/degraded failure | orphan-audit process result | caller receives actionable failure rather than a hung review | fake Git timeout fixture | proved |

## Stateful Transition Matrix

| Start State | Trigger / Interleaving | Durable Invariant | Observer / Recovery Behavior | Focused Test Or Runtime Observation | Result |
|---|---|---|---|---|---|
| Review running required aggregate gate | command yields resumable session or exceeds progress interval | review remains active until command completes or genuinely blocks | user receives progress; session is resumed | yielded-command contract test or controlled shell observation | pending |
| `--until-ready` has unresolved findings | remediation iteration reaches default cap of five | final report still includes full scorecard, cumulative remediation, and residual findings | caller receives `changes-requested`/`blocked`, never a partial success summary | packaged Review contract test | pending |
| One-page navigation active | viewport/scroll/hash changes | one current location reflects the visible section without overflow | desktop/mobile navigation updates and remains keyboard reachable | browser matrix | pending |
| Copy interaction pending | clipboard succeeds or throws | command remains available and status resets after feedback | `Copied` or selected-text fallback is visible/announced | browser interaction observation | pending |

## Decision Fan-Out Ledger

| Date | Decision / Discovery | End-State Consequence | Affected Surfaces To Reconcile | Evidence / Artifact Updates | Status |
|---|---|---|---|---|---|
| 2026-07-23 | Add S6 and S7 rather than expanding S5. | Workflow delivery and public-guide behavior gain predictable durable owners. | Epic Story Index, maps/gaps/evidence, skills, site, README, changelog, Change/review records | proposal/design/tasks updated; Epic pending Apply | open |
| 2026-07-23 | Keep S2/S3 findings in the earlier active Change. | One implementation owner per defect while both Changes share a final candidate. | both Changes, S2/S3 Epic evidence, aggregate/integration gates | coordination row and restart point recorded | open |
| 2026-07-23 | Treat template and runtime as one canonical report contract. | S1 runtime and S5 workflow/template cannot drift independently. | validator, templates/assets, package tests, Epic maps, docs | risk/parity rows seeded | open |
| 2026-07-23 | Public guide is a user-facing package surface. | S7 requires deterministic rendered evidence and owner acceptance. | `site/`, Epic, README/changelog, visual/manual ledgers | experience contract and matrix seeded | open |

## Verification Environment

| Evidence Obligation | Required Setup / Safety Boundary | Needed For | Current Readiness | Result / Resolution |
|---|---|---|---|---|
| CLI/report negative fixtures | disposable temporary repositories only | S1/R4, S5 | ready | existing Node test harness |
| Git option/timeout probes | disposable repo plus fake Git executable; no external user path | S5 | ready | extend orphan-audit test harness |
| Package contract and template parity | local checkout, Node 20+, skill validator via `uv run --with pyyaml` if needed | S5/S6 | ready | current package tooling |
| Rendered guide matrix | local static server plus runtime browser/screenshots; no external account | S7 | ready | prior review proved the setup |
| Prospective integration candidate | temporary Git worktree or immutable merge tree that preserves current worktree | cumulative candidate | ready | `main` and `develop` refs available |
| Owner UI confirmation | exact final Steel candidate URL or local route | S7 closeout | pending | request after Apply/browser verification |

## Verification Scope Decision

- Project-defined aggregate command or authoritative constituent source: `npm run check`
- Aggregate gate required before `in_review`: yes
- Trigger or project-policy reason: cumulative scope crosses CLI validation, security-sensitive Git handling, multiple workflow capabilities, generated/template contracts, and browser-visible behavior.
- Exact committed source candidate: pending Apply.
- Freshness and cache treatment: fresh local run on the immutable committed candidate; record 179-or-current test count and CLI-help result.
- Aggregate result and meaningful execution/count evidence: pending.
- Post-gate evidence-record-only changes and affected checks rerun: classify every later artifact-only edit and rerun scoped validation, diff checks, template parity, and any affected exact test.
- Prospective integration gate required: yes when `develop -> main` produces a materially different tree.
- Current target and prospective integration tree/ref: `main@7e9a2bef9811f623583232c554417ae08ddc9373`; final tree pending.
- Integration-candidate result or reason source proof is reusable: pending merge-tree comparison.
- Remote CI role: corroborating; local exact-candidate aggregate proof remains required before release handoff.

## Manual UI Confirmation

- Status: pending user
- App URL / route: public/local one-page guide root.
- Required setup or test data: exact final committed Steel site served locally or from the candidate deployment.
- Steps for the user: inspect the problem/methodology first half, example Epic, package implementation half, desktop/mobile navigation, and copy command feedback.
- Expected result: reads as restrained documentation; durable Story semantics and package boundaries are clear; navigation and copy interaction feel predictable.
- Feedback that would change artifacts: content hierarchy, Story framing, visual identity, responsive/navigation behavior, or interaction feedback that no longer matches the accepted direction.

## Visual Verification Matrix

| Surface / Route or Fixture | Viewport | State / Interaction | Expected Rendered Behavior | Tool / Setup | Inspected Evidence | Console / Network | Result |
|---|---|---|---|---|---|---|---|
| One-page guide root | 1440×900 | full page, sticky sidebar, active section, Example Epic | bounded reading column, no card pile, balanced headings, contained tables | local static server plus browser screenshots | final screenshots and direct inspection | clean except explicitly accepted asset gaps | pending final candidate |
| One-page guide root | 768×1024 | collapsed navigation, long content | no page overflow; navigation remains reachable | same | final screenshot and measurements | clean | pending final candidate |
| One-page guide root | 375×812 and 320×812 | top, Scenario/evidence rows, footer, focus order | 44px controls, readable type, no collision/overflow | same | final screenshots and keyboard walk | clean | pending final candidate |
| One-page guide root | 812×375 | mobile landscape navigation | header fits and content remains readable | same | final screenshot | clean | pending final candidate |
| Skip/copy/table interactions | desktop and mobile | skip link, keyboard focus, copy success/failure, overflow scroll | visible focus; main receives focus; feedback announced; fallback selects text; table scroll is contained | browser interaction runner | direct observation and screenshot | clean | pending final candidate |
| Motion/contrast | representative desktop/mobile | reduced motion and computed color pairs | smooth motion reduced; required text/control/focus contrast passes | browser emulation/inspection | computed styles and direct inspection | not applicable | pending final candidate |

## Blockers / Open Questions

- Planning blockers: none.
- Implementation blockers: current review findings in `review.md` and the earlier trust-boundary Change must be remediated before review handoff.
- Coordination constraint: do not transition this Change to `in_review` until the earlier Change's S2/S3 findings are resolved or explicitly removed from the cumulative candidate.

## Review Handoff Candidate

- Integration target / merge base: production target `main`; exact merge base pending final Apply.
- Candidate source commit: pending.
- Source differs from target when implementation changed: yes.
- Intended implementation fully committed: no; current site/changelog work remains dirty.
- Unrelated dirty state preserved: required; current dirty product files are in scope for S7/release communication but must not be accidentally committed with unrelated phases.
- Commit-sensitive generated-contract / diff / integration checks: package/template parity, package dry run, skill validation, diff checks, scoped validation, and merge-tree comparison required.
- Verification Scope Decision and aggregate candidate evidence: pending.
- Post-gate evidence-only changes classified and affected checks rerun: pending.
- Prospective integration tree and required gate evidence: pending.
- Required risk, fan-out, environment, or verification rows still pending or blocked: all implementation rows pending.
- Pattern parity, boundary contract, and stateful transition matrices reconciled or not applicable with reason: pending Apply.
- Capability authority, content-budget/provenance conservation, and filesystem mutation-order proof reconciled or not applicable: Git/filesystem boundaries required; content budget not applicable.
- Evidence claims falsified against exact tests, assertions, routes, or observations: pending remediation.
- Fresh-context failure-seeking passes completed: prior review complete; new review required after material fixes.

## Closeout

- Change status: planned.
- Epic files updated: pending Apply; this planning mode does not edit actual Epic truth.
- Story labels/references and Requirement/Scenario IDs current: plan reserves S6/S7 and preserves existing IDs.
- Implemented By maps current: pending Apply.
- One canonical implementation and verification map per Story: required at Apply handoff.
- Primary anchors inspected as behavior-owning definitions/registrations rather than incidental occurrences: pending Apply.
- Scenario-mapped Verified By maps current: pending Apply.
- Superseded earlier Epic truth reconciled: pending Apply.
- README/current-state docs and active/closed Change claims reconciled: pending Apply.
- ADR status: not applicable.
- Release communication current: pending final implementation truth.
- `sdd-review` verdict: `changes-requested` on snapshot `c477e4a`; fresh review required.
- Review record: `review.md`.
- `review.md` findings resolved: no.
- Planning updates resolved: yes after planned transition.
- Implementation risk and confirmation rows resolved: no.
- Pattern parity, boundary contract, and stateful transition rows resolved: no.
- Capability authority, content-budget/provenance conservation, and filesystem mutation-order proof resolved: no.
- Evidence-claim integrity checked: pending Apply.
- Decision fan-out reconciled: planning seeded; Apply must close rows.
- Verification environment obligations resolved: environments identified; final evidence pending.
- Verification Scope Decision current and required candidate gates passed: decision current; gates pending.
- Immutable review handoff candidate: pending.
- Tested integration candidate matches actual integrated tree, or rerun recorded: pending.
- Manual UI confirmation status: pending user.
- Rendered UI verification status: prior snapshot passed; final candidate pending.
- PR / merge state: no current PR/merge action authorized.
- Deferred scope accepted: legacy report rewrite, automatic baseline inference, optional favicon/touch polish.
- Change moved to `docs/changes/closed/`: no.
