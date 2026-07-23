---
status: in_progress
---
# Tasks: Harden Audit Report Integrity

## Resume Here

- Last completed action: independent `/sdd-review` reviewed `develop@373aff7`, passed the complete deterministic and rendered-UI gates, and reproduced three additional S1/R4 integrity defects plus the existing cross-Change S2/S3 gaps.
- Next action: `/sdd-apply` the consolidated report-integrity findings in `review.md`, then apply the separately owned S2/S3 remediation in `2026-07-20-harden-cli-trust-boundaries` before creating one cumulative review candidate.
- Active branch/ref: reviewed source `develop@373aff7a202cfa851c1c6dcf5bf3137f66958b29`; target `main@7e9a2bef9811f623583232c554417ae08ddc9373`; merge base `a670fa28ebfd4df175217b60a74d92cfee520c74`.
- Expected dirty files: safe review remediation in README, CHANGELOG, this ledger, and `review.md` until the review-record commit; clean afterward.
- Known blockers: duplicate last-wins report options, incoherent non-aligned reports, symlinked report-file disappearance, and the separately owned S2/S3 repository collision, concurrent initialization, and planned-path confinement gaps.

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
- [x] 2.3 Add `SDD-E001/S6` Reliable Workflow Execution with independently derived implementation and verification state.
- [x] 2.4 Add `SDD-E001/S7` Accessible Public Methodology Reference with independently derived implementation and verification state.
- [x] 2.5 Reconcile Story Index, current Outcomes, one canonical map per Story, exact primary anchors, evidence, and gaps without claiming proof that has not run.
- [x] 2.6 Reconcile both active Change ledgers and review records to the same current candidate while preserving single finding ownership.

### 3. Implementation

- [x] 3.1 `SDD-E001/S1 R4`: make the validator and real packaged report template one coherent canonical-gate contract.
- [x] 3.2 `SDD-E001/S1 R4`: reject a recognized report kind with a missing schema and require current-Epic/repository proof for aligned reports.
- [x] 3.3 `SDD-E001/S1 R4-S2`: add exact self-referential and non-versioned predecessor behavior/proof.
- [x] 3.4 `SDD-E001/S5`: resolve orphan-audit baselines to immutable commits with option barriers and bounded subprocesses.
- [x] 3.5 `SDD-E001/S6`: reconcile the shipped Planning, Apply, Review, Design, and Interactive workflow contracts and their mirrored templates/doctrine.
- [x] 3.6 `SDD-E001/S7`: reconcile public-guide content, navigation, copy fallback, accessibility, responsive composition, and Steel presentation.
- [x] 3.7 Keep S2/S3 topology, initialization, physical-containment, and recovery remediation in the earlier active Change; consume its verified result rather than duplicate code.
- [x] 3.8 Commit each completed verified and artifact-reconciled Requirement/Scenario phase when files can be isolated safely.

### 4. Verification

- [x] 4.1 Add failing-first tests for each current report/Git finding and inspect the exact assertion and discovery path.
- [x] 4.2 Add or refine exact package contract tests for every S5/S6 Scenario; do not use string presence as proof of behavior it does not exercise.
- [x] 4.3 Add deterministic S7 checks where practical, then directly render and inspect the Visual Verification Matrix.
- [x] 4.4 Run `npm run check`, dependency audit, package dry run, changed-skill validation, template parity, diff checks, `sdd doctor`, scoped validation, and changed-surface reverse traceability.
- [x] 4.5 Run the required aggregate gate freshly against the exact final committed source candidate and record meaningful test counts.
- [x] 4.6 Build the prospective `develop -> main` integration tree and rerun the aggregate gate there if it differs materially from the source candidate.
- [x] 4.7 Keep S1/S5/S6/S7 verification partial or unverified until exact scenario proof and current rendered evidence exist.

### 5. Review And Closeout

- [x] 5.1 Reconcile README, canonical doctrine, templates, changelog, public guide, both active Changes, and current review findings.
- [x] 5.2 Refresh managed skills only through `sdd update`, then verify with `sdd doctor`.
- [ ] 5.3 Record one immutable cumulative review-handoff candidate shared by both active Changes.
- [ ] 5.4 Transition to `in_review` only after implementation, evidence, Epic truth, aggregate/integration gates, and rendered verification are current.
- [x] 5.5 Run a fresh independent `/sdd-review`; do not reuse the `c477e4a` verdict after material remediation.
- [ ] 5.6 Keep manual UI confirmation `pending user` until the owner confirms the exact final Steel candidate.
- [ ] 5.7 Do not push, create a PR, merge, close, tag, publish, or release without the owning workflow and current authorization.

## Implementation Ledger

| Date | Slice | Agent / Guidance | Files / Areas | Result | Commit / Ref |
|---|---|---|---|---|---|
| 2026-07-22 | Initial S1/S5 implementation | main; TDD and package guidance | validator, Epic Verify, PR, Release, templates, docs | Implemented and committed before cumulative review. | `494b121`, `ee1fa1b`, `a670fa2` |
| 2026-07-22 | Independent cumulative review | main plus artifact, code/security, and UI reviewers | full `v0.11.0` candidate | Three blocking and seven required findings consolidated. | reviewed snapshot `c477e4a`; record `4ff9240` |
| 2026-07-23 | Replan | main; `/sdd-change --replan` | proposal, design, tasks, review log | Ownership split revised to S1/S5/S6/S7; S2/S3 boundary retained; Change transitioned to `in_progress`. | `3ec27ab` |
| 2026-07-23 | S1 report integrity | main plus bounded report-contract agent; TDD | report validator, CLI tests, S1 Epic truth | Canonical template gates, recognized missing-schema reports, exact scoped proof, and complete lineage are implemented and verified. | `3d7bffa` |
| 2026-07-23 | S5 immutable Git baseline | bounded code/security agent; TDD | orphan-audit script/tests, S5 Epic truth | Option-like baselines are rejected without side effects; immutable commits and bounded Git subprocesses govern changed-surface audits. | `3d7bffa` |
| 2026-07-23 | S7 public methodology reference | main; agent-browser and deterministic source contracts | Steel site source, site tests, S7 Epic truth | Durable Story semantics, document order, fragments, navigation, copy fallback, focus, responsive containment, and reduced motion are mapped and verified on the immutable source candidate. | `666de8f` |
| 2026-07-23 | S6 workflow execution | bounded artifact/trace agent plus main semantic inspection | Planning, Apply, Review, Design, Interactive, mirrors, doctrine, workflow tests, S6 Epic truth | All six durable workflow Requirements have exact ordered semantic package-contract proof; canonical mirrors are checked byte-for-byte. | `666de8f` |
| 2026-07-23 | Package artifact hygiene | main; package dry-run | npm manifest, package test, S5/R4 Epic truth | Dry run exposed generated Python bytecode; package now excludes `__pycache__` directories and `.pyc` files explicitly. | `20c4934`; Epic reconciliation pending |
| 2026-07-23 | Final self-check remediation | fresh S1/S5 reviewer plus main; adversarial proof | report command parser/repository binding, executable package-manifest test, Epic evidence | Orphan audit must use the exact report repository root; quoted paths remain valid; package proof now inspects actual dry-run contents with injected bytecode. | `02759fe` |
| 2026-07-23 | Final trust-boundary remediation | bounded S1 and code/security reviewers plus main | report validator/tests, orphan-audit script/tests, Epic evidence | Report commands, result coherence, identity, physical containment, and lineage fail closed; every changed-surface Git query is required and fail closed. | `02759fe` |

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
| 2026-07-23 | `node --test test/site.test.js` | deterministic public-guide source contract | Portable-method ordering, durable Story wording, unique fragment targets, skip/focus structure, clipboard fallback, and reduced-motion rules. | passed; 3 tests |
| 2026-07-23 | agent-browser current-source matrix | deterministic rendered UI | Desktop/tablet/mobile/landscape containment, 44px mobile navigation, skip-link focus, injected clipboard fallback, reduced motion, active navigation, contrast, console, and local requests. | passed on working source; immutable-candidate rerun pending |
| 2026-07-23 | `node --test test/workflow-contracts.test.js` | semantic package-contract suite | Complete operative clauses for replan, persistent Apply, full Review, yielded continuation, rendered UI, evidence closure, and Interactive tracking. | passed; 7 tests |
| 2026-07-23 | agent-browser immutable-candidate matrix on `666de8f` | deterministic rendered UI | Exact committed S7 candidate across all planned viewports, overflow bounds, 44px controls, skip focus, injected clipboard denial, reduced motion, active navigation, console, and local requests. | passed; optional deferred favicon request remained the only 404 |
| 2026-07-23 | `sdd update . --json`; `sdd doctor --json` | managed-install/package health | Package source refreshed the managed orphan-audit skill and the resulting installation/configuration is healthy. | passed; one managed skill updated, doctor 0 findings |
| 2026-07-23 | skill validation, dependency audit, and package dry run | package gates | Changed orphan-audit skill is structurally valid, dependencies have no known vulnerabilities, and publish scope excludes generated Python bytecode after remediation. | passed; 0 vulnerabilities, 106 package entries |
| 2026-07-23 | `npm run check` on source candidate `20c4934` | required aggregate gate | Complete implementation candidate before evidence-only Epic/ledger updates. | passed; 197 tests plus CLI help |
| 2026-07-23 | changed-surface orphan audit from `main` after `1485103` | reverse traceability | Cumulative changed runtime and test files have durable ownership/evidence with no broken refs. | passed; 19 candidates, 0 unowned source files, 0 unverified tests, 0 missing refs |
| 2026-07-23 | prospective `main + develop` tree `dee9095f` via temporary commit `852d94d` | required integration gate | Materially different conflict-free production tree preserves the full package behavior. | passed; fresh install, 197 tests plus CLI help |
| 2026-07-23 | focused final-self-check regressions | adversarial automated tests | Wrong orphan-audit repository is rejected, quoted exact paths are accepted, and an injected `.pyc` is absent while source remains in actual npm dry-run output. | passed; 5 report tests and 1 executable package test |
| 2026-07-23 | `node --test test/cli.test.js` after final trust-boundary remediation | full CLI suite | Approved command shape, coherent non-aligned records, fail-closed identity/path handling, and continuous successor results preserve all prior CLI behavior. | passed; 161 tests |
| 2026-07-23 | `node --test test/orphan-audit.test.js` after final trust-boundary remediation | full orphan-audit suite | Every required changed-surface Git query fails closed while safe inventory fallback remains conservative. | passed; 8 tests |
| 2026-07-23 | `npm run check` on source candidate `02759fe` | required aggregate gate | Final committed current-Change implementation preserves the complete package behavior and CLI surface. | passed; 206 tests plus CLI help |
| 2026-07-23 | changed-surface orphan audit from `main` on `02759fe` | reverse traceability | Final cumulative changed runtime and test files retain durable ownership and exact evidence. | passed; 19 candidates, 0 unowned source files, 0 unverified tests, 0 missing refs |
| 2026-07-23 | prospective `main + develop` tree `3b6c505b` via temporary commit `4b39fe4` | required integration gate | The conflict-free production tree preserves the final package behavior. | passed; fresh install, 206 tests plus CLI help |
| 2026-07-23 | independent review of `373aff7` | full review wave | Current artifacts, code/security boundaries, exact evidence, aggregate/package gates, reverse traceability, and current rendered UI. | changes-requested; three new S1/R4 defects and three known S2/S3 gaps |

## Manual Feedback

| Date | Feedback | Classification | Action / Artifact Updates | Status |
|---|---|---|---|---|
| 2026-07-22 | Stories must be durable behavior records; behavior changes update them rather than creating task-like replacements. | requirement refinement | S1/S5 retained; S6/S7 added only for distinct developer and public-reader outcomes. | reconciled in plan |
| 2026-07-22 | The one-pager should use Steel and read as documentation rather than a SaaS landing page. | experience refinement | S7 contract and Visual Verification Matrix preserve the confirmed direction. | direction confirmed; exact candidate pending |

## Planning Updates

| Date | Discovery | Classification | Planning Updates | Next Apply Starting Point |
|---|---|---|---|---|
| 2026-07-23 | Cumulative review found shipped workflow/site behavior outside S1/S5 plus missing report/Git boundary proof. | Epic ownership change and in-scope refinement | Expanded proposal/design; planned S6/S7; refined S1/S5; separated earlier S2/S3 Change ownership; rebuilt risk, scope, environment, handoff, and visual records. | `/sdd-apply` at `SDD-E001/S1 R4` after confirming cross-Change ownership |
| 2026-07-23 | Package dry-run included locally generated Python bytecode from the bundled orphan-audit script. | in-scope refinement | Added S5/R4 portable package behavior, explicit manifest exclusions, and an exact package-contract test. | Continue package and aggregate closure after the isolated hygiene commit. |

## Design Updates

| Date | Feedback / Discovery | Classification | Reference / Target | Preserve / Change / Non-Goals | Artifact Updates | Next Apply Starting Point |
|---|---|---|---|---|---|---|
| 2026-07-23 | Review confirmed the Steel direction and found three safe source/typography defects. | accessibility and responsive correction | current `site/` candidate | Preserve documentation IA/identity; correct semantics, canonical IDs, wrapping; no redesign. | `design.md`, `tasks.md`; safe fixes already in working tree | `/sdd-apply` S7 evidence reconciliation |

## Implementation Risk And Confirmation Matrix

| Requirement / Surface | End-State Invariant | Risk / Failure Mode | Check Or Confirmation Needed | Evidence / Finding | Status |
|---|---|---|---|---|---|
| S1/R4 report contract | A report completed from the shipped template can be validated by the runtime using one canonical gate set. | Template/runtime drift makes `aligned` impossible or falsely permissive. | Template-derived fixture plus exact gate parity and contradictory-result tests. | Real 18-gate template fixture and full CLI suite pass. | proved |
| S1/R4 report identity/evidence | Every recognized report is validated and only current-Epic/repository proof can certify it. | Missing schema hides the report; another Epic or repository's checks certify it. | Missing-schema, wrong-Epic, wrong structural repository, wrong orphan-audit root, and quoted-path fixtures. | All exact negative cases pass; quoted exact paths remain accepted. | proved |
| S1/R4 lineage | Predecessors are versioned immutable reports in the same Epic review directory. | Self or non-versioned targets satisfy an overstated Scenario. | Exact self/non-versioned tests plus evidence update. | Exact self, non-versioned, missing, and absolute predecessor tests pass. | proved |
| S1/R4 command/result coherence | Required checks begin with an approved executable and every result carries complete current evidence. | Embedded command text or incomplete non-aligned reports satisfy the contract. | Spoofed-command and result-specific incomplete-report fixtures. | Exact command-shape and every non-aligned coherence case pass. | proved |
| S1/R4 identity/containment | Malformed typed identity and external review roots fail closed. | Invalid YAML types crash validation or symlinked report storage crosses the repository boundary. | Typed-path, malformed raw identity, and external reviews-directory fixtures. | All cases return deterministic findings without trusting external artifacts. | proved |
| S5 immutable Git selection | User-controlled baseline cannot become a Git option or hang the workflow. | Option injection writes outside the repo; subprocess never returns. | `rev-parse --verify --end-of-options`, immutable commit, option barrier, timeout probes. | Exact no-side-effect option-injection and fake-Git timeout tests pass. | proved |
| S6 workflow contracts | Planning/Apply/Review/Design/Interactive guidance, templates, doctrine, and tests agree on end-state behavior. | Broad string tests pass while one workflow stops early or omits a required final report. | Exact package contract assertions plus semantic source inspection. | Seven ordered semantic tests cover complete operative clauses and canonical mirror parity. | proved |
| S7 public guide | Current source remains readable, navigable, accessible, and truthful across representative states. | Source checks miss invalid DOM, interaction fallback, overflow, or visual regression. | Visual Verification Matrix plus static DOM/ID/fragment checks. | Static contracts and the full rendered matrix pass on immutable candidate `666de8f`. | proved |
| Cross-Change integration | Every defect has one owner and both ledgers identify the same final candidate. | Duplicate fixes, stale watermarks, or incompatible Epic updates. | Compare both task/review records before each handoff. | S1/S5/S6/S7 are proved here; S2/S3 remain explicitly assigned to the earlier Change. | blocked on earlier Change |

## Pattern Parity Matrix

| Concern | Reference Location / Contract | New Location / Contract | Focused Proof | Intentional Divergence / Gap | Status |
|---|---|---|---|---|---|
| Versioned report runtime/template parity | `src/epic-verify-report.js#CANONICAL_GATES` | canonical and packaged Epic Verify report templates | template-derived aligned-report test | none permitted | matched |
| Workflow final-report parity | single review final report | `--until-ready` final report | packaged Review contract test plus rereview output | iteration history may be cumulative; final fields may not diverge | matched |
| Rendered navigation and interaction | desktop Steel documentation shell | tablet/mobile navigation and copy fallback | browser matrix with keyboard and clipboard-failure states | composition may collapse responsively without losing semantics | matched on `666de8f` |

## Boundary Contract Matrix

| Origin Condition | Domain Result / Invariant | Adapter / Transport Mapping | Client Behavior / Retryability | Exact Proof | Status |
|---|---|---|---|---|---|
| Report kind recognized but schema absent | deterministic invalid-report finding | validator JSON finding | caller can fix the report; it never disappears | missing-schema focused test | proved |
| Aligned report cites another Epic | scoped proof rejected | validator report finding | caller reruns validation/orphan audit for the current Epic | wrong-Epic and wrong-repository focused tests | proved |
| Git baseline starts with option syntax | ref rejected before diff | orphan-audit structured failure/exit | no external write; caller supplies a valid ref | option-injection and valid-ref tests | proved |
| Git subprocess exceeds bound | deterministic timeout/degraded failure | orphan-audit process result | caller receives actionable failure rather than a hung review | fake Git timeout fixture | proved |
| Required changed-surface Git query fails | deterministic fail-closed audit result | orphan-audit process result | caller fixes Git access/state; missing output is never treated as an empty change set | four injected baseline/unstaged/staged/untracked failures | proved |

## Stateful Transition Matrix

| Start State | Trigger / Interleaving | Durable Invariant | Observer / Recovery Behavior | Focused Test Or Runtime Observation | Result |
|---|---|---|---|---|---|
| Review running required aggregate gate | command yields resumable session or exceeds progress interval | review remains active until command completes or genuinely blocks | user receives progress; session is resumed | `test/workflow-contracts.test.js#packaged Review resumes yielded commands and preserves the full until-ready report contract` | proved |
| `--until-ready` has unresolved findings | remediation iteration reaches default cap of five | final report still includes full scorecard, cumulative remediation, and residual findings | caller receives `changes-requested`/`blocked`, never a partial success summary | `test/workflow-contracts.test.js#packaged Review resumes yielded commands and preserves the full until-ready report contract` | proved |
| One-page navigation active | viewport/scroll/hash changes | one current location reflects the visible section without overflow | desktop/mobile navigation updates and remains keyboard reachable | browser matrix | passed on `666de8f` |
| Copy interaction pending | clipboard succeeds or throws | command remains available and status resets after feedback | `Copied` or selected-text fallback is visible/announced | injected clipboard failure selected the full command and announced `Selected` | passed on `666de8f` |

## Decision Fan-Out Ledger

| Date | Decision / Discovery | End-State Consequence | Affected Surfaces To Reconcile | Evidence / Artifact Updates | Status |
|---|---|---|---|---|---|
| 2026-07-23 | Add S6 and S7 rather than expanding S5. | Workflow delivery and public-guide behavior gain predictable durable owners. | Epic Story Index, maps/gaps/evidence, skills, site, README, changelog, Change/review records | S6/S7 maps, exact tests, and rendered evidence reconciled | reconciled |
| 2026-07-23 | Keep S2/S3 findings in the earlier active Change. | One implementation owner per defect while both Changes share a final candidate. | both Changes, S2/S3 Epic evidence, aggregate/integration gates | coordination and exact restart recorded; implementation remains | blocked on earlier Change |
| 2026-07-23 | Treat template and runtime as one canonical report contract. | S1 runtime and S5 workflow/template cannot drift independently. | validator, templates/assets, package tests, Epic maps, docs | template-derived 18-gate fixture and exact scope tests pass | reconciled |
| 2026-07-23 | Public guide is a user-facing package surface. | S7 requires deterministic rendered evidence and owner acceptance. | `site/`, Epic, README/changelog, visual/manual ledgers | source contracts and committed-candidate browser matrix pass; owner preference remains pending | reconciled technically |
| 2026-07-23 | Universal bundled scripts must not publish local compile artifacts. | S5 owns a clean portable audit package in addition to runtime Git safety. | package manifest, package test, package dry run, S5 map/evidence | bytecode exclusions and exact proof added | reconciled |

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
- Exact committed source candidate: current implementation `02759fe`; later edits are artifact-only reconciliation.
- Freshness and cache treatment: fresh local run on the immutable committed candidate; record 179-or-current test count and CLI-help result.
- Aggregate result and meaningful execution/count evidence: `npm run check` passed 206 tests plus CLI help on `02759fe`.
- Post-gate evidence-record-only changes and affected checks rerun: classify every later artifact-only edit and rerun scoped validation, diff checks, template parity, and any affected exact test.
- Prospective integration gate required: yes when `develop -> main` produces a materially different tree.
- Current target and prospective integration tree/ref: `main@7e9a2bef9811f623583232c554417ae08ddc9373`; final tree `3b6c505b276633e7a4125b3f7845c948b9eb2782` via temporary commit `4b39fe4c8a2d447b18de9ba2fb83a3af704228f8`.
- Integration-candidate result or reason source proof is reusable: fresh install and `npm run check` passed 206 tests plus CLI help on the exact final prospective tree.
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
| One-page guide root | 1440×900 | full page, sticky sidebar, active section, Example Epic | bounded reading column, no card pile, balanced headings, contained tables | local static server plus agent-browser | full-page screenshot directly inspected; document composition and table containment match the Steel direction | clean; accepted optional favicon 404 only | passed on `666de8f` |
| One-page guide root | 768×1024 | collapsed navigation, long content | no page overflow; navigation remains reachable | same | `scrollWidth === clientWidth === 768` | clean | passed on `666de8f` |
| One-page guide root | 375×812 and 320×812 | top, Scenario/evidence rows, footer, focus order | 44px controls, readable type, no collision/overflow | same | 320px full-page screenshot inspected; both mobile navs measured 44px; scroll widths equal client widths | clean | passed on `666de8f` |
| One-page guide root | 812×375 | mobile landscape navigation | header fits and content remains readable | same | `scrollWidth === clientWidth === 812` | clean | passed on `666de8f` |
| Skip/copy/table interactions | desktop and mobile | skip link, keyboard focus, copy success/failure, overflow scroll | visible focus; main receives focus; feedback announced; fallback selects text; table scroll is contained | agent-browser interaction runner | skip link became visible/focused and moved focus to main; injected clipboard denial selected command and announced `Selected` | clean | passed on `666de8f` |
| Motion/contrast | representative desktop/mobile | reduced motion and computed color pairs | smooth motion reduced; required text/control/focus contrast passes | browser emulation/inspection | computed scroll behavior `auto`, transition `0.00001s`, and active navigation retained; working-source sampled ratios remained unchanged in committed source | not applicable | passed on `666de8f` |

## Blockers / Open Questions

- Planning blockers: none.
- Implementation blockers: three current S1/R4 findings in `review.md` and the earlier trust-boundary Change's S2/S3 gaps must be remediated before review handoff.
- Coordination constraint: do not transition this Change to `in_review` until the earlier Change's S2/S3 findings are resolved or explicitly removed from the cumulative candidate.

## Review Handoff Candidate

- Integration target / merge base: production target `main`; merge base `a670fa28ebfd4df175217b60a74d92cfee520c74`.
- Candidate source commit: reviewed source `373aff7`; invalidated for readiness by current review findings.
- Source differs from target when implementation changed: yes.
- Intended implementation fully committed: no; S1/R4 retains three current gaps while S5/S6/S7 remain complete.
- Unrelated dirty state preserved: yes; all formerly dirty Steel product files were confirmed in-scope and committed in `666de8f`.
- Commit-sensitive generated-contract / diff / integration checks: package/template parity, package dry run, skill validation, diff checks, scoped validation, reverse traceability, and merge-tree aggregate checks passed.
- Verification Scope Decision and aggregate candidate evidence: source `02759fe` passed 206 tests plus CLI help; exact prospective integration tree `3b6c505b` passed the same gate.
- Post-gate evidence-only changes classified and affected checks rerun: current Epic/ledger-only reconciliation requires scoped validation, reverse traceability, diff checks, and the final integration-tree rerun.
- Prospective integration tree and required gate evidence: tree `3b6c505b` via temporary commit `4b39fe4` passed a fresh install, 206 tests, and CLI help.
- Required risk, fan-out, environment, or verification rows still pending or blocked: only cross-Change S2/S3 implementation owned by `2026-07-20-harden-cli-trust-boundaries`.
- Pattern parity, boundary contract, and stateful transition matrices reconciled or not applicable with reason: S1 command-option and report-file boundaries now have findings; cumulative state also remains blocked on earlier S2/S3.
- Capability authority, content-budget/provenance conservation, and filesystem mutation-order proof reconciled or not applicable: Git/filesystem boundaries required; content budget not applicable.
- Evidence claims falsified against exact tests, assertions, routes, or observations: review falsified three S1/R4 completion claims; S5/S6/S7 claims remain proved.
- Fresh-context failure-seeking passes completed: artifact/trace, code/security, exact evidence, deterministic tooling, and independent rendered UI passes completed; a new review is required after S1/S2/S3 remediation.

## Closeout

- Change status: in_progress; transition to `in_review` is blocked by separately owned cumulative S2/S3 findings.
- Epic files updated: S1 is partial with three current report-integrity gaps; S2/S3 remain partial; S5/S6/S7 retain current implementation and evidence.
- Story labels/references and Requirement/Scenario IDs current: yes.
- Implemented By maps current: yes, with explicit S1/S2/S3 implementation gaps.
- One canonical implementation and verification map per Story: yes.
- Primary anchors inspected as behavior-owning definitions/registrations rather than incidental occurrences: yes.
- Scenario-mapped Verified By maps current: yes, with explicit S1/S2/S3 verification gaps.
- Superseded earlier Epic truth reconciled: yes.
- README/current-state docs and active/closed Change claims reconciled: current Change and release communication yes; earlier Change is updated to retain S2/S3 ownership.
- ADR status: not applicable.
- Release communication current: changelog and public guide match current S1/S5/S6/S7 truth.
- `sdd-review` verdict: `changes-requested` on source `373aff7`; fresh review required after remediation.
- Review record: `review.md`.
- `review.md` findings resolved: no; three current-Change S1/R4 findings and three earlier-Change S2/S3 gaps remain.
- Planning updates resolved: yes after planned transition.
- Implementation risk and confirmation rows resolved: no; S1 report-integrity and cross-Change S2/S3 blockers remain.
- Pattern parity, boundary contract, and stateful transition rows resolved: no; report option semantics, report-file containment, and cumulative S2/S3 remain.
- Capability authority, content-budget/provenance conservation, and filesystem mutation-order proof resolved: no.
- Evidence-claim integrity checked: yes; three S1/R4 claims were reopened as gaps.
- Decision fan-out reconciled: yes except the explicitly blocked earlier-Change implementation.
- Verification environment obligations resolved: yes for current scope.
- Verification Scope Decision current and required candidate gates passed: aggregate source, package, traceability, and rendered gates passed, but code/security findings invalidate readiness.
- Immutable review handoff candidate: none; reviewed source `373aff7` has current findings and the shared candidate remains blocked on S2/S3.
- Tested integration candidate matches actual integrated tree, or rerun recorded: historical prospective tree `3b6c505b` passed before review findings; no current integration candidate is certifiable.
- Manual UI confirmation status: pending user.
- Rendered UI verification status: current source `373aff7` independently passed the full matrix.
- PR / merge state: no current PR/merge action authorized.
- Deferred scope accepted: legacy report rewrite, automatic baseline inference, optional favicon/touch polish.
- Change moved to `docs/changes/closed/`: no.
