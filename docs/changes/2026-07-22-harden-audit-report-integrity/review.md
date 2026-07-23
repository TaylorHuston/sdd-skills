# Review: Harden Audit Report Integrity

## Verdict

changes-requested

This scorecard and verdict are the immutable historical review of candidate `c477e4a`. Later Apply logs/checkmarks record remediation progress but do not replace this reviewed watermark. A fresh independent review must produce the current scorecard after the separately owned S2/S3 findings are resolved.

## Gate Scorecard

| Gate | Result | Notes |
|---|---|---|
| Change artifacts | findings | The declared S1/S5 scope does not own all behavior shipped by the cumulative candidate. |
| Change status | findings | Artifact invalidation requires `in_review` to return to `proposed`. |
| Epic truth | findings | S1 evidence overstates lineage coverage; several shipped skill and site behaviors have no durable Story owner. |
| Canonical map authority | pass | No competing current or historical implementation or verification maps found. |
| Requirements and Scenarios | findings | Self-referential and non-versioned predecessor cases are claimed but not tested. |
| Story reference traceability | pass after safe fix | Two stale S5 test-title anchors were corrected during review. |
| Reverse traceability | findings | 22 changed source candidates lack `Implemented By` ownership; behavior-owning examples are listed below. |
| Tests and verification | findings | The broad suite passes, but seven falsification gaps or defects remain. |
| Verification scope and aggregate candidate | findings | `npm run check` passed on the reviewed tree; the candidate is not releasable while current findings remain. |
| Semantic anchor ownership | pass | Existing implementation anchors resolve to governing definitions or skill entry points. |
| Evidence falsification | findings | Report schema, Epic scope, lineage, concurrency, path confinement, and Git-option boundaries lack valid proof. |
| Pattern conformance | findings | The shipped report template and validator disagree about their canonical gate set. |
| Boundary contracts | findings | Repository artifact ownership and owner-relative planning paths can cross intended boundaries. |
| Stateful transitions | findings | Concurrent repository initialization can report two successes while retaining only one writer. |
| Rendered UI verification | pass after safe fixes | Desktop, tablet, mobile, focus, navigation, copy, overflow, reduced-motion, contrast, and console/network states were inspected. |
| Manual UI confirmation | pending user | The Steel one-pager has independent rendered proof but no owner confirmation of this exact candidate. |
| Code review | findings | Two blocking implementation defects and five required defects remain. |
| Visual / UX consistency | pass after safe fixes | Invalid list markup, noncanonical Scenario IDs, and heading wrapping were corrected. |
| Security review | findings | Orphan-audit option injection and two path/ownership boundary defects remain. |
| Documentation | findings | The task ledger and ownership model do not yet describe the cumulative behavior truthfully. |
| Idea repository / current-state truth | not applicable | Repository-only package; no private Idea mapping. |
| Release communication | findings | The changelog advertises behavior that is not yet durably owned and verified. |
| Branch and merge readiness | findings | Four product files remain uncommitted and implementation findings block release. |
| Prospective integration candidate | pass for conflict only | `main` plus reviewed candidate is conflict-free and produced the reviewed tree; correctness gates have findings. |
| PRD alignment | not applicable | No PRD governs this package Change. |

## Findings

### BLOCKING

- [x] `src/epic-verify-report.js:27` and `docs/templates/epic-verify-report.md:50` - Resolved in `3d7bffa`: runtime and the real shipped template share the 18-gate contract, exercised by a template-derived aligned fixture.
- [ ] `src/workspace.js:91` - Repository-only context can overwrite an existing same-ID Idea and replace global artifact defaults. Existing mapped repositories can then resolve to the unmapped repository's artifact directories. Recommendation: reject synthetic-ID collisions and retain repository-specific artifacts only on the synthetic repository entry.
- [x] `docs/changes/2026-07-22-harden-audit-report-integrity/proposal.md:14` - Resolved through replan and `666de8f`: S6 owns workflow execution and S7 owns the public methodology reference with exact maps and proof.

### REQUIRED

- [x] `src/epic-verify-report.js:124` - Resolved in `3d7bffa`: recognized schema-less reports produce a deterministic finding and remain counted.
- [x] `src/epic-verify-report.js:253` - Resolved in `3d7bffa`: exact Epic, repository, and audited-ref option values are required, including a prefix-confusable repository regression.
- [ ] `src/commands/init-installation.js:140` - Concurrent repository initialization can report success to both writers while silently retaining one. Recommendation: serialize initialization or use expected-absence publication/CAS and test the race.
- [ ] `src/config.js:428` and `src/commands/validate.js:1145` - `planning.plannedChangesDirectory` can escape its planning owner. Recommendation: restrict owner-relative artifact directories and defensively verify physical containment before reads.
- [x] `skills/sdd-orphan-audit/scripts/sdd_orphan_audit.py:56` - Resolved in `3d7bffa`: baselines resolve through an option barrier to immutable commits and every Git subprocess is bounded; no-side-effect injection and fake-Git timeout tests pass.
- [x] `docs/epics/sdd-e001-reliable-cli-operations/epic.md:127` - Resolved in `3d7bffa`: exact self-referential and non-versioned predecessor tests now back S1/R4-S2.
- [x] `docs/changes/2026-07-22-harden-audit-report-integrity/tasks.md:1` - Resolved through replan and Apply: all required risk, fan-out, environment, candidate, and visual records are populated with current evidence.

### SUGGESTION

- [ ] `src/commands/init.js:98` and `src/commands/init-installation.js:93` - First-time recovery discards cleanup errors and may leave durable state while reporting only the original failure. Recommendation: aggregate recovery failures under the existing mutation-recovery contract.
- [ ] `site/index.html:4` - Add a favicon when a stable package mark exists; the current browser request returns 404.
- [ ] `site/styles.css:96` - Consider an intentional `-webkit-tap-highlight-color` for touch feedback.

## Verification Evidence

| Command / Scenario | Evidence Type | Requirement / Scenario | Result | What It Proves |
|---|---|---|---|---|
| `npm run check` | aggregate candidate gate | cumulative package candidate | pass; 179 tests | Current implemented suite and CLI help pass; missing adversarial cases remain findings. |
| `npm audit --omit=dev --json` | broad supporting gate | production dependencies | pass; 0 vulnerabilities | No known production dependency advisories. |
| `npm pack --dry-run --json` | package gate | release contents | pass; 106 files | Internal audits, active Changes, and Epics are excluded from the package. |
| all 14 `quick_validate.py` skill checks | package skill gate | bundled skills | pass | Every bundled skill is structurally valid. |
| `sdd validate ... --change <id> --changed-from v0.11.0 --json` | deterministic SDD gate | both active Changes | initial findings | Two stale S5 anchors were found and corrected; a post-fix recheck is recorded below. |
| `sdd_orphan_audit.py . --format json --epic SDD-E001 --changed-from v0.11.0` | reverse traceability | cumulative source/test surface | findings | 22 source candidates lack ownership; no mapped anchor or test reference is broken. |
| template/asset byte comparisons | generated-contract gate | four changed template pairs | pass | Canonical and bundled copies match byte-for-byte. |
| temporary validator, topology, concurrency, containment, and Git probes | falsification | report and trust boundaries | findings | Each code/security defect above reproduced independently. |
| Chromium rendered matrix | deterministic UI verification | public one-pager | pass after three safe fixes | Representative viewports, keyboard paths, copy feedback, reduced motion, contrast, overflow, and console/network state were directly inspected. |

## Verification Scope And Candidate Gates

- Project-defined aggregate command or authoritative constituent source: `npm run check`
- Aggregate gate required: yes
- Trigger or project-policy reason: cumulative release candidate crosses CLI validation, topology, mutation, packaged scripts, workflow skills, documentation, and UI.
- Cache/freshness policy: fresh local execution; no cached result accepted.
- Post-gate evidence-record-only changes and affected checks rerun: safe anchor/UI fixes require scoped validation, syntax, static integrity, and aggregate reruns before handoff.

| Stage | Exact Commit / Tree | Command | Meaningful Execution / Counts | Result |
|---|---|---|---|---|
| Reviewed source candidate | synthetic commit `c477e4aedbb118b88dac5f2a0d97b1e8bcbbe2df`, tree `cd1c5593e482c392a7cf80c9c59e6716ec75cfc9` | `npm run check` | 179 tests plus CLI help | pass with review findings |
| Prospective integration candidate | tree `cd1c5593e482c392a7cf80c9c59e6716ec75cfc9` | `git merge-tree --write-tree main c477e4a...` | byte-identical, conflict-free tree | conflict pass; correctness findings |
| Actual integrated result | `main@7e9a2bef9811f623583232c554417ae08ddc9373` | history inspection | committed CLI/workflow work already merged; Steel site work is not | findings |

## Boundary And Conservation Review

- Boundary Contract Matrix status and exact proof: findings in repository artifact ownership, planned-Change containment, and Git argument handling.
- Capability identifier issuer, scope, lifetime, and invalid-reuse proof: not applicable.
- Content-budget and provider-visible provenance conservation: not applicable.
- Filesystem ancestor/confinement validation before mutation and fail-closed no-write proof: existing symlink/CAS tests pass, but owner-relative planning confinement and orphan-audit Git handling remain findings.

## Rendered UI Verification

| Surface / Route or Fixture | Viewport | State / Interaction | Tool / Setup | Directly Inspected Evidence | Console / Network | Result |
|---|---|---|---|---|---|---|
| Public one-pager | 1440×900 | full page, Example Epic, sticky navigation | Chromium/local static server | restrained Steel documentation layout; no page overflow | clean except missing favicon | pass after safe fixes |
| Public one-pager | 768×1024 | compact navigation, long content | Chromium/local static server | sidebar collapses and tables remain contained | clean except missing favicon | pass |
| Public one-pager | 375×812, 320×812, 812×375 | skip link, focus, copy, footer, landscape | Chromium/local static server | 44px controls, visible focus, clipboard announcement, no collisions | clean except missing favicon | pass |
| Public one-pager | representative desktop/mobile | reduced motion and contrast | browser emulation plus computed colors | motion reduced; all measured text/control/focus pairs pass | not applicable | pass |

## Review Bundle

- Source branch/ref: `develop@a670fa28ebfd4df175217b60a74d92cfee520c74` plus tracked working-tree content
- Reviewed source commit: synthetic immutable snapshot `c477e4aedbb118b88dac5f2a0d97b1e8bcbbe2df`
- Target branch/ref: `main@7e9a2bef9811f623583232c554417ae08ddc9373`
- Merge base: `a670fa28ebfd4df175217b60a74d92cfee520c74`
- Source-only commits: synthetic review snapshot only
- Target-only commits: one merge commit
- Changed files: 74 from `v0.11.0`; four tracked product files from current `main`
- Diff stat: 10,317 insertions and 1,278 deletions from `v0.11.0`
- Conflict check: pass
- Prospective integration tree: `cd1c5593e482c392a7cf80c9c59e6716ec75cfc9`
- Source and target refs used for candidate proof: `c477e4a...` and `7e9a2be...`
- Dirty state: `CHANGELOG.md`, `site/index.html`, `site/site.js`, and `site/styles.css`; review-authorized Epic/review records added afterward
- Branch policy: production target; no merge, push, close, release, or PR authorized by review
- Reverse-traceability command/result: 49 source candidates, 29 implementation refs, 16 primary refs, 22 unowned source candidates, 0 broken implementation/evidence refs, 0 unverified test files

## Reverse Traceability

- Candidate scope: cumulative `v0.11.0` through the exact reviewed synthetic snapshot.
- Epic ownership reconciled: no; Apply, Review, Change, Design, Interactive, and public-site behavior require explicit ownership decisions.
- Support/generated/framework classifications: template assets are mirrored generated contracts; package docs and helper assets remain supporting only where they do not define behavior.
- Stranded refactor surfaces checked: changed skill entry points, site JavaScript/CSS, CLI modules, bundled scripts, and tests were inventoried.
- Explicit gaps or tracked cleanup: recorded in current findings; no broad behavior surface was silently classified as support.

## Discovery Wave

| Pass | Reviewer | Result | Notes |
|---|---|---|---|
| Artifact truth | independent subreview | findings | stale anchors, ownership gaps, overstated evidence, and stale ledgers found |
| Reverse traceability | independent subreview plus script | findings | 22 unowned source candidates |
| Code diff | independent subreview | findings | report, topology, init, and recovery defects |
| Verification coverage | primary plus independent subreview | findings | broad suite passes; adversarial gaps remain |
| Evidence falsification | independent subreview | findings | seven defects/gaps reproduced |
| Pattern conformance | independent subreview | findings | template/validator gate mismatch |
| Boundary contracts | independent subreview | findings | topology, planning, and Git argument boundaries |
| Stateful transitions | independent subreview | findings | concurrent init loses one writer |
| Security / authority / budget / mutation safety | independent subreview | findings | option injection and cross-owner path risks |
| UI / visual identity | independent browser review | pass after safe fixes | three required source/typography fixes applied |
| Docs / Idea truth / release communication / PRD | artifact review | findings | ownership and task ledger incomplete; Idea/PRD not applicable |
| Integration readiness | primary | findings | conflict-free, but correctness and commit state block release |

## Consolidated Remediation

- Root causes addressed: only safe, mechanical review findings were changed in this pass.
- Safe-fix batch: corrected two exact test anchors, valid list markup, canonical Scenario IDs, and balanced heading wrapping.
- Deferred or unsafe findings: all code/security defects, missing tests/evidence, Story ownership, and ledger replanning.
- Affected verification union: aggregate package suite, both scoped SDD validations, reverse traceability, skill checks, package dry run, static-site syntax/integrity, and rendered UI.
- Regression-focused rereview: pending implementation/replan.
- New regressions introduced by remediation: none observed; final rechecks recorded after this review file.

## PR / Merge Readiness

- Source branch: `develop`
- Reviewed source commit: `c477e4aedbb118b88dac5f2a0d97b1e8bcbbe2df`
- Target branch: `main`
- Tested integration tree/ref: `cd1c5593e482c392a7cf80c9c59e6716ec75cfc9`
- Source/target refs rechecked immediately before integration: no integration authorized
- Actual integrated tree matches tested tree: no; current `main` predates the uncommitted Steel site work
- Required aggregate rerun after drift: required after Apply remediation
- Conflict check: pass
- Commit state: implementation candidate is not fully committed
- PR status: not requested
- Merge status: not requested

## Review Log

- 2026-07-22: Deep cumulative review created for both active Changes. Verdict `changes-requested`; safe anchor and UI fixes applied; planning and implementation findings routed back to their owning workflows.
- 2026-07-22: Post-fix recheck passed `npm run check` (179/179), both scoped SDD validations (0 errors, 0 warnings), `sdd doctor`, `git diff --check`, JavaScript syntax, fragment integrity, package dry run (106 files), dependency audit (0 vulnerabilities), and the focused desktop/mobile rendered regression. Reverse traceability still reports 22 unowned source candidates, as expected for the unresolved planning finding.
- 2026-07-23: `/sdd-change --replan` resolved the planning shape by retaining S1/S5, planning S6 Reliable Workflow Execution and S7 Accessible Public Methodology Reference, and leaving S2/S3 remediation with the earlier active Change. Proposal, design, and tasks passed scoped validation and returned to `planned`; implementation, Epic reconciliation, and fresh review remain required.
- 2026-07-23: `/sdd-apply` resolved every S1/S5/S6/S7 finding, committed the Steel site and durable ownership, refreshed the managed orphan-audit skill through `sdd update`, passed 197 source and prospective-integration tests, eliminated reverse-traceability gaps, and verified the committed UI matrix. The historical verdict remains `changes-requested` because the earlier Change still owns unresolved S2/S3 findings; a fresh independent review is required after those are applied.
- 2026-07-23: Fresh-context Apply self-check found two evidence defects: reverse-inventory proof was not bound to the report repository, and the package test asserted manifest strings rather than actual dry-run contents. Apply added exact repository-root/quoted-path report tests and an executable npm-pack fixture with injected bytecode; all focused checks pass.
- 2026-07-23: Final failure-seeking passes closed report command spoofing, non-aligned coherence, malformed/typed identity, physical reviews-directory containment, successor-result continuity, and fail-open changed-surface Git queries. The focused and full affected suites pass; aggregate and integration gates remain to be refreshed on the final candidate.
- 2026-07-23: Final source `02759fe` passed 206 tests plus CLI help, managed-install health, package dry run, dependency audit, and reverse traceability with zero ownership/evidence gaps. Prospective production tree `3b6c505b` passed a fresh install and the same 206-test aggregate gate. This Change remains `in_progress` solely because the earlier Change still owns unresolved S2/S3 findings.
