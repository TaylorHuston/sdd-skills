# Review: Harden Audit Report Integrity

## Verdict

changes-requested

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

- [ ] `src/epic-verify-report.js:27` and `docs/templates/epic-verify-report.md:50` - The validator defines 17 canonical gates while both shipped templates define 18. A report completed from the package template cannot reach `aligned`. Recommendation: make one canonical gate definition authoritative across validator, templates, assets, and a template-derived contract test.
- [ ] `src/workspace.js:91` - Repository-only context can overwrite an existing same-ID Idea and replace global artifact defaults. Existing mapped repositories can then resolve to the unmapped repository's artifact directories. Recommendation: reject synthetic-ID collisions and retain repository-specific artifacts only on the synthetic repository entry.
- [ ] `docs/changes/2026-07-22-harden-audit-report-integrity/proposal.md:14` - The Change declares only S1 and S5 ownership, while the cumulative candidate ships behavior changes in Apply, Review, Change, Design, Interactive, and the public site. Recommendation: replan the Change so every accepted behavior has a durable Story owner, or split the extra behavior into a separately tracked Change/Epic.

### REQUIRED

- [ ] `src/epic-verify-report.js:124` - A report with `kind: sdd-epic-verify-report` but no schema disappears from validation. Recommendation: treat a recognized kind with a missing schema as malformed and add a negative test.
- [ ] `src/epic-verify-report.js:253` - An aligned report can cite validation and orphan-audit rows for another Epic. Recommendation: require the current repository and `--epic <epicId>` scope and add a falsification test.
- [ ] `src/commands/init-installation.js:140` - Concurrent repository initialization can report success to both writers while silently retaining one. Recommendation: serialize initialization or use expected-absence publication/CAS and test the race.
- [ ] `src/config.js:428` and `src/commands/validate.js:1145` - `planning.plannedChangesDirectory` can escape its planning owner. Recommendation: restrict owner-relative artifact directories and defensively verify physical containment before reads.
- [ ] `skills/sdd-orphan-audit/scripts/sdd_orphan_audit.py:56` - Raw `--changed-from` input is passed to Git before an option barrier and subprocesses have no timeout. A probe created a file outside the audited repository through Git option injection. Recommendation: resolve the ref through `rev-parse --verify --end-of-options`, use the immutable commit with `--`, and bound every subprocess.
- [ ] `docs/epics/sdd-e001-reliable-cli-operations/epic.md:127` - S1/R4-S2 claims rejection of self-referential and non-versioned predecessors, but its evidence only covers missing and external predecessors. Recommendation: add focused tests/evidence or downgrade verification and record both gaps.
- [ ] `docs/changes/2026-07-22-harden-audit-report-integrity/tasks.md:1` - The ledger lacks the scope decision, risk/fan-out, pattern/boundary/stateful, environment, immutable handoff, and visual-verification records required by the implemented scope. Recommendation: rebuild these sections during `/sdd-change --replan`.

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
