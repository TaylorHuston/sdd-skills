---
status: proposed
---
# Tasks: Harden Audit Report Integrity

## Resume Here

Independent `/sdd-review` returned `changes-requested`. Replan durable Story ownership for the broader shipped workflow/site behavior and rebuild the missing risk, verification, handoff, and visual-review sections before returning to Apply. The detailed findings are in `review.md`; no push, PR, merge, close, or release was performed.

## Interactive Log

| Time | Request / Feedback | Classification | Files / Artifacts | Verification |
|---|---|---|---|---|
| 2026-07-22 | Apply the workflow improvements identified from PR #3. | requirement refinement | This Change; validator, Epic, skills, templates, docs | In progress. |
| 2026-07-22 | Commit all current skill changes and ensure README, changelog, and one-page guide are current. | delivery authorization and supporting-truth reconciliation | Complete package worktree; `README.md`; `CHANGELOG.md`; `site/index.html` | Commit authorized; push, PR, merge, and release remain unauthorized. |

## Checklist

- [x] Capture the approved scope and technical boundary.
- [x] Add focused failing-first validator tests.
- [x] Implement versioned Epic verification report validation.
- [x] Implement opt-in Git-relative Epic metadata validation.
- [x] Reconcile Epic truth and package documentation.
- [x] Tighten Epic verification, release, and PR skills and templates.
- [x] Run package, skill, SDD, and managed-install verification.
- [x] Complete an independent fresh-context review.

## Implementation Ledger

- `test/cli.test.js`: initial failing-first coverage for coherent reports, contradictory aligned reports, broken supersedes links, and stale Epic `modified` metadata.
- `src/epic-verify-report.js`: versioned report identity, current-result, required-section/check, and lineage validation.
- `src/epic-history.js`, `src/commands/validate.js`, `src/cli.js`: opt-in working-tree comparison against a resolved per-repository Git baseline.
- `skills/sdd-epic-verify/`: immutable current/historical report lifecycle and multi-Epic batch coherence.
- `skills/sdd-pr/`, `skills/sdd-release/`: default safe remediation plus exact diff and per-commit path allowlists.
- `docs/templates/`, `docs/story-driven-development.md`, `README.md`, `CHANGELOG.md`, `site/index.html`: mirrored templates, doctrine, CLI documentation, release communication, and public methodology summary.
- `docs/epics/sdd-e001-reliable-cli-operations/epic.md`: S1 validator behavior and S5 packaged workflow behavior with navigable code/skill anchors.
- `docs/changes/2026-07-20-harden-cli-trust-boundaries/tasks.md`: reconciled stale dirty-worktree and commit-blocker claims to committed candidate `a7eeb06` and independent-review readiness.

## Verification Ledger

- RED: focused tests initially failed for report counts/coherence, broken lineage, and stale `modified` metadata before implementation.
- GREEN: `npm run check` — 179 tests pass and CLI help renders.
- GREEN: local `sdd validate ... --change 2026-07-22-harden-audit-report-integrity --changed-from HEAD --json` — 0 errors, 0 warnings.
- GREEN: changed-surface orphan audit — 0 unmapped source files, 0 unmapped tests, 0 missing implementation/evidence references.
- GREEN: `quick_validate.py` for `sdd-epic-verify`, `sdd-pr`, and `sdd-release` through `uv run --with pyyaml`.
- GREEN: all four changed docs/skill template pairs are byte-identical; `git diff --check` passes; `npm pack --dry-run --json` succeeds with 106 package entries.
- GREEN: all six changed skill folders pass `quick_validate.py`; the public one-page guide renders successfully in Chromium with its updated lifecycle content, intact accessibility structure, and no page-console errors.
- GREEN: independent fresh-context review found four report-integrity issues; all four were remediated and the focused recheck found no remaining actionable issue.
- GREEN: `sdd update` refreshed managed `sdd-epic-verify`, `sdd-pr`, and `sdd-release` from package source; all other managed skills remained unchanged.
- GREEN: `sdd doctor /Users/taylor/src/my-life/spaces/sdd-skills --json` — healthy, 0 errors, 0 warnings.

## Manual UI Confirmation

- Status: not applicable
- App URL / route: not applicable; this is CLI and workflow-package behavior.
- Required setup or test data: temporary fixture repositories created by automated tests.
- Steps for the user: none.
- Expected result: not applicable.
- Feedback that would change artifacts: reports from a real repository that valid current-state reports are rejected or contradictory aligned reports are accepted.

## Artifact Updates

- New lightweight Change created at `docs/changes/2026-07-22-harden-audit-report-integrity/`.
- Epic SDD-E001 now treats both deterministic CLI validation and packaged audit/handoff skills as implemented product behavior.
- Release communication updated in the README, Unreleased changelog, and public one-page guide.

## Open Questions

- None.

## Closeout

- Review record: implementation self-review clean after one consolidated remediation pass; formal `/sdd-review` remains recommended before integration.
- Manual UI confirmation status: not applicable.
- Release communication status: current in `README.md`, `CHANGELOG.md`, and `site/index.html`.
- PR / merge state: no PR or merge requested.
- Deferred gaps accepted: none yet.
- Folder state: active.
- Commit state: user-authorized; the package commit containing this ledger records the completed implementation and supporting-truth reconciliation.
