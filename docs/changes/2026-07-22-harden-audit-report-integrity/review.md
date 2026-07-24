# Review: Harden Audit Report Integrity

## Historical Verdict

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

## Current Re-Review — 2026-07-23

### Verdict

ready

The historical `changes-requested` verdict above is retained as evidence for `373aff7`. The coordinated implementation candidate `6086e07` resolves every recorded S1/R4, S2, and S3 finding. This review's record reconciliation is documentation-only and revalidated before its containing commit. The owner confirmed the exact Steel candidate at `develop@c9c3cb0` on 2026-07-23. Both Changes remain `in_review`; the release workflow may open its PR, while merge and closeout remain separately authorized.

### Current Gate Scorecard

| Gate | Result | Notes |
|---|---|---|
| Change artifacts | pass | Both coordinated Changes are coherent and remain `in_review`. |
| Change status | pass | No review finding reopened either Change. |
| Epic truth / canonical maps | pass after safe remediation | Current maps cover the two published planning-path schemas as supporting S3/R2-S3 ownership. |
| Requirements, Scenarios, and evidence falsification | pass | Prior report-integrity, topology, concurrency, and containment regressions have exact focused proof. |
| Story reference and reverse traceability | pass after safe remediation | Both scoped validations: 0 errors, one intentional large-Story warning; 27 candidates with zero ownership/evidence gaps. |
| Tests and aggregate verification | pass | `npm run check`: 212 tests plus CLI help; dependency audit: 0 production vulnerabilities. |
| Pattern, boundary, stateful-transition, and security review | pass | Independent code/security pass found no remaining actionable defect. |
| Package and skill integrity | pass | `npm pack --dry-run` contains 106 expected files; 14 bundled skill files passed structural frontmatter validation. |
| Rendered UI verification | pass | Full desktop/tablet/mobile/interactions matrix remains applicable because `site/` is unchanged since `666de8f`; current desktop and 375px rendering were directly inspected, with no horizontal overflow or console error. Only `/favicon.ico` returns 404. |
| Manual UI confirmation | user confirmed | Owner confirmed the exact Steel documentation candidate at `develop@c9c3cb0` on 2026-07-23. |
| Documentation and release communication | pass after safe remediation | README, CHANGELOG, Epic map, and both ledgers agree that owner-relative planned paths are enforced. |
| Integration candidate | pass | `git merge-tree --write-tree main 6086e07` produced conflict-free tree `8aed3a589d26751420a9c20a0f3a8ecc85657303`; its aggregate gate passed. |
| Branch and merge readiness | ready for release handoff | `develop` is technically ready; production policy requires `/sdd-release` for any PR/release action. |
| PRD / Idea truth | not applicable | This is a repository-only package with no governing PRD. |

### Current Findings

### BLOCKING

- None.

### REQUIRED

- None.

### SUGGESTION

- [ ] `site/index.html:4` - Provide a favicon when a stable package mark exists; the browser still receives a non-blocking `/favicon.ico` 404.

### Current Verification And Integration Evidence

| Command / Scenario | Result | What It Proves |
|---|---|---|
| `npm run check` | pass; 212 tests plus CLI help | Full package suite on the review-authorized source worktree. |
| `sdd validate` for each active Change | pass; 0 errors, 1 intentional warning each | Current Change, Epic, map, and evidence structure are coherent. |
| orphan audit, full and `--epic SDD-E001` | pass; 27 candidates, zero gaps | Every changed source/test candidate has current implementation and verification ownership. |
| `npm audit --omit=dev --json` and `npm pack --dry-run --json` | pass; 0 vulnerabilities, 106 files | Production dependency graph and published package inventory are clean. |
| `git merge-tree --write-tree main 6086e07` plus aggregate gate | pass | Exact prospective integration tree is conflict-free and passed its required aggregate check. |
| rendered current source | pass; desktop and 375px inspected | No desktop/mobile overflow or console errors; site assets match the prior full matrix source. |

### Current Review Log

- 2026-07-23: Independent cumulative re-review discovered only safe traceability and documentation drift: two schema ownership rows, stale ledger watermarks, and stale public confinement wording. The single safe batch resolved them and regression checks remained green.

## PR Remediation Re-Review — 2026-07-24

### Verdict

ready for remote rereview

`55f7b73` resolves all current PR feedback: governing proof recognizes the supported equals-form CLI option syntax, repository-only status keeps committed artifact roots, public Change material no longer exposes a local path, and stale closeout wording is reconciled. The aggregate source candidate is clean; this review does not authorize merge.

### Evidence

| Gate | Result |
|---|---|
| Aggregate package gate | `npm run check` passed 214 tests plus CLI help. |
| Scoped structural validation | Both active Changes passed with 0 errors and one intentional large-Story warning each. |
| Reverse traceability | `SDD-E001` audit found 29 candidates and zero ownership or verification gaps. |
| Package/security | `npm pack --dry-run` listed 106 files; production audit reported 0 vulnerabilities. |
| Exact integration tree | `git merge-tree --write-tree origin/main 55f7b73` produced `15429fcd8e10ab6172816302a6308c04edb6da87`, identical to the source tree. |
| Rendered UI | Reused the 2026-07-23 current-source matrix: no `site/` asset changed in this remediation. |

### Review Log

- 2026-07-24: Current PR feedback reproduced the report parser's equals-form gap. TDD remediation added exact syntax coverage; the companion status and record corrections passed every local release gate. A configured remote rereview is required after push.
