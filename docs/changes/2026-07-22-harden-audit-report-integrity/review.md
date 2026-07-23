# Review: Harden Audit Report Integrity

## Verdict

changes-requested

Reviewed source `373aff7a202cfa851c1c6dcf5bf3137f66958b29` passes the deterministic package, traceability, and rendered-UI gates, but three S1/R4 report-integrity defects and three explicitly tracked S2/S3 gaps prevent a truthful cumulative handoff.

The earlier `c477e4aedbb118b88dac5f2a0d97b1e8bcbbe2df` review remains historical evidence. This record supersedes its scorecard for the current source; it does not rewrite the earlier reviewed result.

## Gate Scorecard

| Gate | Result | Notes |
|---|---|---|
| Change artifacts | findings | Current Change scope is mapped, but its cumulative handoff depends on unresolved S2/S3 work in the companion Change. |
| Change status | pass after safe remediation | Review began at `in_review`; current findings returned the Change to `in_progress`. |
| Epic truth | findings | S1/R4 needs three new failure Scenarios/proofs; S2 and S3 correctly remain partial with explicit gaps. |
| Canonical map authority | pass | Every Story has one current `Implemented By` and one current `Verified By` map. |
| Requirements and Scenarios | findings | Duplicate last-wins options, incoherent non-aligned reports, and symlinked report files are not represented or proved. |
| Story reference traceability | pass | Scoped validation and direct anchor inspection found no broken references. |
| Reverse traceability | pass | 19 candidates; zero unowned source, unverified tests, or missing implementation/evidence refs. |
| Tests and verification | findings | 206 tests pass, but adversarial reproductions expose three uncovered S1/R4 defects. |
| Verification scope and aggregate candidate | pass for source | Fresh `npm run check` passed 206 tests plus CLI help on `373aff7`; findings still invalidate readiness. |
| Semantic anchor ownership | pass | Changed Requirements lead to governing validator, audit, skill, or site definitions. |
| Evidence falsification | findings | Existing named tests are discovered and assert their stated cases, but do not cover the reproduced bypasses. |
| Pattern conformance | findings | Option handling disagrees with last-wins Node/Python CLI parsing semantics. |
| Boundary contracts | findings | Report command scope and report-file containment can be misrepresented or disappear. |
| Stateful transitions | findings | Concurrent first repository initialization remains an explicit S2 gap. |
| Rendered UI verification | pass | Current source independently passed desktop, tablet, mobile, landscape, interaction, overflow, motion, and console checks. |
| Manual UI confirmation | pending user | Owner confirmation of the exact Steel documentation candidate remains pending. |
| Code review | findings | Three report validator defects reproduced; companion Change retains three implementation gaps. |
| Visual / UX consistency | pass | Independent screenshots show a readable documentation shell without clipping, collision, or page overflow. |
| Security review | findings | Duplicate option scope and symlinked report disappearance weaken audit evidence integrity. |
| Documentation | pass after safe remediation | README, CHANGELOG, tasks, and this review record were narrowed to current truth. |
| Idea repository / current-state truth | not applicable | Repository-only package; no private Idea mapping exists. |
| Release communication | pass after safe remediation | README and CHANGELOG no longer claim complete owner-relative planning-path confinement. |
| Branch and merge readiness | findings | `develop` is cleanly ahead of `main`, but current findings block release handoff. |
| Prospective integration candidate | blocked | A clean merge tree exists, but no exact post-review candidate can be certified while implementation findings remain. |
| PRD alignment | not applicable | No PRD governs this repository-only Change. |

## Findings

### BLOCKING

- [ ] `src/epic-verify-report.js:138-159` - Aligned-report command validation accepts the first matching `--epic`, `--repo`, or `--changed-from` value while Node `parseArgs` and Python `argparse` execute repeated options with last-value semantics. A row such as a correctly scoped command followed by a conflicting duplicate can therefore certify proof that actually ran against another scope. Recommendation: reject duplicate governing options or validate the effective last value, with exact aligned-report regressions for every governed option.
- [ ] `docs/changes/2026-07-20-harden-cli-trust-boundaries/tasks.md:37-47` - The cumulative candidate still has explicit gaps for concurrent first repository initialization, synthetic repository-ID collision, and owner-relative `plannedChangesDirectory` confinement. Recommendation: complete the owning Change and its adversarial proof before creating one shared review candidate.

### REQUIRED

- [ ] `src/epic-verify-report.js:376-400` - A non-aligned report without `BLOCKING` or `REQUIRED` headings is interpreted as having a current finding, and any arbitrary check row/result satisfies the current-check requirement. The validator accepts an internally malformed report containing an unrelated command and invalid result. Recommendation: require the result-appropriate finding section and at least one syntactically valid current check with an allowed result.
- [ ] `src/epic-verify-report.js:192-204` - A symlinked Markdown report inside an otherwise contained reviews directory is silently filtered out because its directory entry is not a regular file. Validation returns zero reports and no unsafe-path finding, allowing an audit record to disappear through an external target. Recommendation: inspect Markdown symlink entries and fail closed on non-regular or physically external report files.

### SUGGESTION

- [ ] `site/index.html:4` - Add a favicon when a stable package mark exists; current Chromium requests `/favicon.ico` and receives the only observed 404.

## Verification Evidence

| Command / Scenario | Evidence Type | Requirement / Scenario | Result | What It Proves |
|---|---|---|---|---|
| `npm run check` | aggregate candidate gate | cumulative source candidate | pass; 206 tests plus CLI help | Current checked package suite passes on `373aff7`. |
| targeted report-integrity suite | focused automated test | S1/R4 existing Scenarios | pass; 20 tests | Existing canonical gates, scope, identity, lineage, and coherence cases are discovered and pass. |
| `node --test test/site.test.js test/workflow-contracts.test.js test/orphan-audit.test.js test/package.test.js` | focused automated test | S5/S6/S7 | pass; 19 tests | Package, workflow, audit, and source-level site contracts pass. |
| duplicate-option, malformed non-aligned, and symlinked-report probes | adversarial falsification | S1/R4 | findings; all three reproduced | Current validator accepts or hides evidence that the intended trust contract should reject. |
| `sdd validate ... --change ... --changed-from main --json` | deterministic SDD gate | current Change and Epic | pass; 0 errors, 1 large-Story warning | Artifact shape, references, and Epic metadata are structurally coherent. |
| `sdd_orphan_audit.py . --epic SDD-E001 --changed-from main --format json` | reverse traceability | cumulative diff | pass; 19 candidates, zero gaps | Every changed source/test candidate is classified by current Epic maps. |
| `npm audit --omit=dev --json` | broad supporting gate | dependencies | pass; 0 vulnerabilities | No known production dependency advisories. |
| `npm pack --dry-run --json` | package gate | S5/R4 | pass; 106 files | No internal Change/Epic records or Python cache artifacts are published. |
| all 14 `quick_validate.py` checks via `uv run --with pyyaml` | skill package gate | S6 | pass | Every bundled skill is structurally valid. |
| independent Chromium matrix | deterministic rendered UI | S7 | pass | Current documentation UI works across required sizes and interactions. |

## Verification Scope And Candidate Gates

- Project-defined aggregate command: `npm run check`
- Aggregate gate required: yes
- Trigger: validator, security-sensitive Git/report handling, workflow contracts, package contents, documentation, and UI all changed.
- Cache/freshness policy: fresh local execution; no cached result accepted.
- Post-gate safe review changes: documentation/status/review records only; scoped validation, docs/source contracts, diff checks, and traceability must be rerun after the safe-fix commit.

| Stage | Exact Commit / Tree | Command | Meaningful Execution / Counts | Result |
|---|---|---|---|---|
| Reviewed source candidate | `373aff7a202cfa851c1c6dcf5bf3137f66958b29` | `npm run check` | 206 tests plus CLI help | pass with review findings |
| Prospective integration candidate | pre-remediation tree `48266d03604fc86a86c555c5ee972d8589e2e9af` | `git merge-tree --write-tree main 373aff7` | conflict-free tree | correctness blocked by findings |
| Actual integrated result | `main@7e9a2bef9811f623583232c554417ae08ddc9373` | branch/history inspection | predates current cumulative candidate | not applicable |

## Boundary And Conservation Review

- Boundary Contract Matrix: findings for report option scope, report-file containment, synthetic ownership collision, and planned-path confinement.
- Capability identifiers: not applicable.
- Content-budget and provider provenance: not applicable.
- Filesystem safety: current repository-artifact and review-directory checks pass their named cases; symlinked report files and owner-relative planned paths remain findings.

## Rendered UI Verification

| Surface / Route or Fixture | Viewport | State / Interaction | Tool / Setup | Directly Inspected Evidence | Console / Network | Result |
|---|---|---|---|---|---|---|
| One-page guide | 1440×900 | full page, sticky sidebar, active section | local server plus Chromium | bounded reading column and contained Example Epic | clean except favicon 404 | pass |
| One-page guide | 768×1024 | compact navigation and long tables | same | zero page overflow; focusable table scroll reaches max | clean except favicon 404 | pass |
| One-page guide | 375×812 and 320×812 | navigation, content, table, copy, focus | same | zero page overflow; readable inspected 320px screenshot; 44px navigation | clean except favicon 404 | pass |
| One-page guide | 812×375 | mobile landscape | same | readable inspected screenshot without collision or clipping | clean except favicon 404 | pass |
| Skip/copy/motion | representative desktop/mobile | skip focus, copy success, injected clipboard denial, reduced motion | same | main receives focus; `Copied`; `Selected` plus all 160 chars selected; auto scroll and 0.01ms transitions | runtime errors empty | pass |

## Review Bundle

- Source branch/ref: `develop@373aff7a202cfa851c1c6dcf5bf3137f66958b29`
- Target branch/ref: `main@7e9a2bef9811f623583232c554417ae08ddc9373`
- Merge base: `a670fa28ebfd4df175217b60a74d92cfee520c74`
- Source-only commits: 13 commits from `3ec27ab` through `373aff7`
- Target-only commits: merge commit `7e9a2be`
- Changed files: 19
- Diff stat: 5,054 insertions and 725 deletions
- Conflict check: pass
- Prospective integration tree: `48266d03604fc86a86c555c5ee972d8589e2e9af`
- Dirty state at discovery: only the guarded review-start status transition; safe review remediation followed.
- Branch policy: `develop` is day-to-day integration; `main` is stable production and requires `/sdd-release`.
- Reverse traceability: 19 candidates, 40 implementation refs, 26 primary refs, 15 verification refs, zero missing/unowned/unverified.

## Reverse Traceability

- Candidate scope: `main...develop` plus current review artifact state.
- Epic ownership: current for S1/S5/S6/S7; explicit partial S2/S3 gaps remain.
- Support/generated/framework classifications: package manifest, changelog, docs, template assets, and site document structure were inspected.
- Stranded surfaces: no orphaned changed source or test files found.
- Explicit gaps: three S1/R4 findings above and the companion S2/S3 Change.

## Discovery Wave

| Pass | Reviewer | Result | Notes |
|---|---|---|---|
| Artifact truth | independent artifact reviewer | findings | Status/candidate drift and companion gaps confirmed. |
| Reverse traceability | main plus packaged audit | pass | No unowned or unverified candidate. |
| Code diff | independent code reviewer plus main | findings | Three report-integrity defects reproduced. |
| Verification coverage | main and UI/verification reviewer | findings | Existing suite is green but omits reproduced cases. |
| Evidence falsification | independent code reviewer | findings | Duplicate options, malformed non-aligned record, and symlinked file bypasses confirmed. |
| Pattern conformance | main | findings | Governing option semantics differ from downstream parsers. |
| Boundary contracts | independent code reviewer | findings | Scope and report containment can be misrepresented. |
| Stateful transitions | artifact/code review | findings | Companion concurrent-init gap remains. |
| Security / authority / budget / mutation safety | independent code reviewer | findings | Audit-evidence integrity and filesystem gaps remain. |
| UI / visual identity | independent browser reviewer | pass | Full current-source matrix passed. |
| Docs / Idea truth / release communication / PRD | artifact reviewer plus main | pass after safe fixes | Overstated confinement language narrowed; Idea/PRD not applicable. |
| Integration readiness | main | findings | Conflict-free but correctness findings block release handoff. |

## Consolidated Remediation

- Root causes addressed: stale current-review/status records and overbroad public confinement claims.
- Safe-fix batch: returned Change to `in_progress`; refreshed Resume Here, evidence, and current review; narrowed README and CHANGELOG.
- Deferred findings: all S1/R4 code/test work and companion S2/S3 implementation require `/sdd-apply`.
- Affected verification union: scoped SDD validation, site/workflow source contracts, reverse traceability, diff checks, and review artifact inspection.
- Regression rereview: required after the safe-fix batch; no application behavior is changed by that batch.

## PR / Merge Readiness

- Source: `develop`
- Reviewed source: `373aff7a202cfa851c1c6dcf5bf3137f66958b29`
- Target: `main`
- Conflict check: pass
- Required aggregate after implementation remediation: yes
- Commit state: safe review record pending commit
- PR status: not requested; production PR belongs to `/sdd-release`
- Merge status: not requested and blocked

## Review Log

- 2026-07-22: Historical cumulative review of `c477e4a` returned `changes-requested`.
- 2026-07-23: Apply resolved the original S1/S5/S6/S7 batch and produced source `373aff7`.
- 2026-07-23: Fresh review passed 206-test/package/traceability/UI gates, reproduced three new S1/R4 defects, confirmed three companion S2/S3 gaps, returned the Change to `in_progress`, and applied only safe artifact/release-communication corrections.
