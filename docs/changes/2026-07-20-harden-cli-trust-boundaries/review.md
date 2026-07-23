# Review: Harden CLI Trust Boundaries

## Verdict

changes-requested

This Change was reviewed as part of the cumulative `v0.11.0` candidate. The complete bundle, UI matrix, branch evidence, and release-candidate analysis are recorded in [`../2026-07-22-harden-audit-report-integrity/review.md`](../2026-07-22-harden-audit-report-integrity/review.md).

## Gate Scorecard

| Gate | Result | Notes |
|---|---|---|
| Change artifacts | findings | The Epic evidence overstates one lineage Scenario and the ledger is stale after production integration. |
| Change status | findings | Implementation invalidation requires `in_review` to return to `in_progress`. |
| Epic truth | findings | S1/R4-S2 lacks proof for self-referential and non-versioned predecessors. |
| Canonical map authority | pass | One current implementation and verification map per Story. |
| Requirements and Scenarios | findings | Claimed lineage cases are not fully exercised. |
| Story reference traceability | pass after safe fix | Two later S5 anchors were corrected in the shared Epic. |
| Reverse traceability | findings | The cumulative candidate contains unowned workflow/site behavior; the follow-up Change owns replanning. |
| Tests and verification | findings | Broad suite passes, but trust-boundary falsification exposed current defects. |
| Verification scope and aggregate candidate | findings | Fresh aggregate pass does not override missing adversarial cases. |
| Semantic anchor ownership | pass | Current mapped implementation anchors resolve. |
| Evidence falsification | findings | Topology, concurrency, containment, and Git-option probes fail. |
| Pattern conformance | findings | Validator and shipped report template disagree. |
| Boundary contracts | findings | Repository artifact ownership and planning-path confinement can cross owners. |
| Stateful transitions | findings | Concurrent repository initialization loses a writer. |
| Rendered UI verification | not applicable | This Change's declared scope has no UI. |
| Manual UI confirmation | not applicable | This Change's declared scope has no UI. |
| Code review | findings | Two blocking and five required implementation defects remain across the cumulative code. |
| Visual / UX consistency | not applicable | This Change's declared scope has no UI. |
| Security review | findings | Option injection and cross-owner path risks remain. |
| Documentation | findings | Review handoff and production-integration claims are stale. |
| Idea repository / current-state truth | not applicable | Repository-only package. |
| Release communication | findings | Shared cumulative ownership must be replanned before release. |
| Branch and merge readiness | findings | Correctness findings block readiness. |
| Prospective integration candidate | pass for conflict only | Conflict-free does not mean review-ready. |
| PRD alignment | not applicable | No PRD governs this Change. |

## Findings

### BLOCKING

- [ ] `src/epic-verify-report.js:27` and `docs/templates/epic-verify-report.md:50` - The validator's 17 canonical gates cannot accept the shipped 18-gate report template. Recommendation: unify the canonical contract and test a real template-derived aligned report.
- [ ] `src/workspace.js:91` - Repository-only context can replace an existing same-ID Idea and global artifact defaults, redirecting unrelated mapped repositories. Recommendation: reject the collision and keep artifacts local to the synthetic repository.

### REQUIRED

- [ ] `src/epic-verify-report.js:124` - Removing the schema from a recognized report kind makes the report disappear. Recommendation: reject it as malformed.
- [ ] `src/epic-verify-report.js:253` - An unrelated Epic's checks can certify an aligned report. Recommendation: enforce current Epic and repository scope.
- [ ] `src/commands/init-installation.js:140` - Concurrent initialization can report two successes and retain one writer. Recommendation: lock or publish with expected absence.
- [ ] `src/config.js:428` and `src/commands/validate.js:1145` - `plannedChangesDirectory` can escape its planning owner. Recommendation: enforce relative configuration and physical containment.
- [ ] `skills/sdd-orphan-audit/scripts/sdd_orphan_audit.py:56` - `--changed-from` permits Git option injection and subprocesses are unbounded. Recommendation: validate/resolve the ref, add `--`, and add timeouts.
- [ ] `docs/epics/sdd-e001-reliable-cli-operations/epic.md:127` - Add proof for self-referential and non-versioned predecessors or downgrade S1/R4-S2 verification.
- [ ] `docs/changes/2026-07-20-harden-cli-trust-boundaries/tasks.md:173` - Reconcile the review handoff with the actual merge into `main@7e9a2be` and the current cumulative candidate.

### SUGGESTION

- [ ] `src/commands/init.js:98` and `src/commands/init-installation.js:93` - Surface cleanup failures through the existing mutation-recovery error contract.

## Verification Evidence

| Command / Scenario | Evidence Type | Requirement / Scenario | Result | What It Proves |
|---|---|---|---|---|
| `npm run check` | aggregate candidate gate | cumulative candidate | pass; 179 tests | Existing suite remains green, but does not exercise the findings. |
| 84 focused mutation, topology, report, lifecycle, and diagnostics tests | focused automated tests | S1-S4 | pass | Existing covered behavior remains stable. |
| temporary report/topology/init/path/Git probes | adversarial falsification | S1-S3 trust boundaries | findings | Each current defect reproduced outside the existing suite. |
| `sdd validate ... --change 2026-07-20-harden-cli-trust-boundaries --changed-from v0.11.0` | deterministic SDD gate | Change and Epic | initial findings | Two stale shared S5 anchors were found and safely corrected. |
| changed-surface orphan audit | reverse traceability | cumulative candidate | findings | No broken mapped references; broader ownership gaps remain. |

## Verification Scope And Candidate Gates

- Project-defined aggregate command or authoritative constituent source: `npm run check`
- Aggregate gate required: yes
- Trigger or project-policy reason: trust-boundary and cross-command mutation changes.
- Cache/freshness policy: fresh local execution.
- Post-gate evidence-record-only changes and affected checks rerun: recorded in the cumulative review.

| Stage | Exact Commit / Tree | Command | Meaningful Execution / Counts | Result |
|---|---|---|---|---|
| Reviewed source candidate | `c477e4aedbb118b88dac5f2a0d97b1e8bcbbe2df` / `cd1c5593e482c392a7cf80c9c59e6716ec75cfc9` | `npm run check` | 179 tests | pass with review findings |
| Prospective integration candidate | `cd1c5593e482c392a7cf80c9c59e6716ec75cfc9` | merge-tree conflict check | byte-identical tree | conflict pass; correctness findings |
| Actual integrated result | `main@7e9a2bef9811f623583232c554417ae08ddc9373` | history inspection | original implementation already merged | findings discovered post-integration |

## Boundary And Conservation Review

- Boundary Contract Matrix status and exact proof: findings for artifact ownership, planning containment, and Git argument handling.
- Capability identifier issuer, scope, lifetime, and invalid-reuse proof: not applicable.
- Content-budget and provider-visible provenance conservation: not applicable.
- Filesystem ancestor/confinement validation before mutation and fail-closed no-write proof: current symlink/CAS tests pass; two additional boundary findings remain.

## Rendered UI Verification

Not applicable to the declared scope of this Change. The follow-up Change owns the cumulative site's rendered review.

## Review Bundle

- Source branch/ref: `develop@a670fa28ebfd4df175217b60a74d92cfee520c74` plus tracked working-tree content
- Reviewed source commit: synthetic snapshot `c477e4aedbb118b88dac5f2a0d97b1e8bcbbe2df`
- Target branch/ref: `main@7e9a2bef9811f623583232c554417ae08ddc9373`
- Merge base: `a670fa28ebfd4df175217b60a74d92cfee520c74`
- Changed files and diff stat: 74 files, 10,317 insertions, 1,278 deletions from `v0.11.0`
- Conflict check: pass
- Prospective integration tree: `cd1c5593e482c392a7cf80c9c59e6716ec75cfc9`
- Dirty state: four pre-review product files plus review-authorized artifacts and safe fixes
- Branch policy: production target; review does not authorize merge, push, close, release, or PR
- Reverse-traceability result: no broken mapped refs; 22 cumulative source candidates need ownership classification

## Reverse Traceability

- Candidate scope: cumulative `v0.11.0` through reviewed snapshot.
- Epic ownership reconciled: no; follow-up replanning owns the broader skill/site decision.
- Support/generated/framework classifications: mirrored templates and non-behavioral assets only.
- Stranded refactor surfaces checked: CLI modules, workflow skills, bundled scripts, site behavior, and tests.
- Explicit gaps or tracked cleanup: current findings above and the follow-up review.

## Discovery Wave

| Pass | Reviewer | Result | Notes |
|---|---|---|---|
| Artifact truth and reverse traceability | independent subreview | findings | overstated evidence and stale ledger |
| Code, verification, pattern, boundary, and state | independent subreview | findings | seven reproduced defects/gaps |
| Security and mutation safety | independent subreview | findings | option injection and cross-owner boundaries |
| UI / visual identity | independent browser review | not applicable here | recorded against follow-up Change |
| Integration readiness | primary | findings | already integrated implementation needs correction |

## Consolidated Remediation

- Root causes addressed: two exact shared Epic anchors were corrected.
- Safe-fix batch: evidence-anchor spelling only for this Change.
- Deferred or unsafe findings: implementation defects, missing adversarial tests, ledger reconciliation.
- Affected verification union: aggregate suite, scoped validation, reverse traceability, skill/package gates.
- Regression-focused rereview: required after Apply.
- New regressions introduced by remediation: none observed.

## PR / Merge Readiness

- Source branch: `develop`
- Reviewed source commit: `c477e4aedbb118b88dac5f2a0d97b1e8bcbbe2df`
- Target branch: `main`
- Tested integration tree/ref: `cd1c5593e482c392a7cf80c9c59e6716ec75cfc9`
- Actual integrated tree matches tested tree: no; `main` contains the earlier committed implementation but not current Steel/site work
- Required aggregate rerun after drift: yes
- Conflict check: pass
- Commit state: cumulative candidate not fully committed
- PR status: not requested
- Merge status: earlier implementation merged; no current merge requested

## Review Log

- 2026-07-22: Deep cumulative review created. Verdict `changes-requested`; implementation findings require `/sdd-apply`.
- 2026-07-22: Post-fix recheck passed `npm run check` (179/179), scoped SDD validation (0 errors, 0 warnings), `sdd doctor`, package/diff checks, and the shared rendered regression; current implementation and ownership findings remain open.
