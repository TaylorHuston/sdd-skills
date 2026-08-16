# Final Change Review: CHANGE TITLE

## Review Scope

- Central Change: `<workspace>/.sdd/changes/yyyy-mm-dd-change-name/`
- Space: `<space-id>`
- Target repository IDs: `<repository-id, ...>`
- Source/target and exact candidate per repository: `<record below>`

This file is the final Change-wide integration Review. Candidate-bound Requirement-slice Reviews live separately under `slice-reviews/`.

## Verdict

blocked | changes-requested | ready

- Implementation Quality: findings | cannot-verify | pass
- Spec Adherence: findings | cannot-verify | pass
- Manual acceptance: pending user | accepted gap | user confirmed | not applicable

## Gate Execution Manifest

| Gate | Result | Method / command | Candidate | Durable proof reference |
|---|---|---|---|---|
| artifact-truth | findings | TBD | TBD | TBD |
| canonical-map-authority | findings | TBD | TBD | TBD |
| source-vs-target | findings | TBD | TBD | TBD |
| pattern-conformance | not-applicable | TBD | TBD | TBD |
| boundary-contracts | not-applicable | TBD | TBD | TBD |
| reverse-traceability | findings | TBD | TBD | TBD |
| verification | findings | TBD | TBD | TBD |
| evidence-falsification | findings | TBD | TBD | TBD |
| risk-shaped-evidence | findings | TBD | TBD | TBD |
| security-data-safety | findings | TBD | TBD | TBD |
| rendered-ui | not-applicable | TBD | TBD | TBD |
| manual-acceptance | pass | TBD | TBD | TBD |
| supporting-truth | findings | TBD | TBD | TBD |
| integration-readiness | findings | TBD | TBD | TBD |

## Findings

### BLOCKING

- None.

### REQUIRED

- None.

### SUGGESTION

- None.

For every BLOCKING or REQUIRED finding, record its admission ground: explicit accepted-contract violation, material safety, project policy, false closure, or deterministic-gate failure. Classify remediation as `product-defect` or `closure-repair`.

## Scenario Evidence Closure

| Repository | Scenario | Claimed boundary | Cited proof | Proven boundary | Evidence type | Durability / reproduction reference | Result | Gap |
|---|---|---|---|---|---|---|---|---|
| repository-id | EPIC-ID/S1 R1-S1 | TBD | TBD | TBD | automated / rendered / mixed / ... | TBD | pass / accepted-gap / findings / blocked | none / required / manual-acceptance / optional-confidence:<reference> / user-accepted:yyyy-mm-dd |

## Visual Verification

| Repository | Requirement / Surface | Viewport | State / Interaction | Observed | Proof | Console / Network | Result | Gap |
|---|---|---|---|---|---|---|---|---|
| repository-id | TBD | desktop / mobile | TBD | TBD | TBD | clean / findings / not applicable | pass / accepted-gap / findings / blocked | none / required / user-accepted:yyyy-mm-dd |

## Repository Review Bundle: <repository-id>

Repeat for every target repository.

- Repository ID:
- Source branch/ref and exact commit:
- Target branch/ref and merge base:
- Source-only and target-only commits:
- Changed files and diff stat:
- Dirty state:
- Branch policy:
- Conflict check and prospective integration tree:
- Project aggregate gate and exact result:
- Reverse-traceability command, counts, and classifications:
- Security/data-safety result:
- Documentation and release-communication result:
- PR/merge state:

## Consolidated Remediation

- Discovery Review candidate and findings:
- Admitted safe remediation batch:
- Verification rerun:
- Fresh final Review candidate and result:
- Regression introduced by remediation: none / exact correction
- Remaining findings requiring user decision:

Do not begin another broad remediation cycle after the final Review. A new pre-existing issue returns `needs-user`; only a regression introduced by the remediation batch receives one narrow correction.

## Manual Acceptance

- Status:
- Suggested walkthrough:
- Acceptance-dependent handoff still blocked:

## Closeout And Handoff

- Change status:
- Repository-specific integration readiness:
- Changelog/release communication:
- PR/merge/close action taken, offered, or blocked:
- Remaining risks:
- Recommended next workflow:

## Review Log

- yyyy-mm-dd: Final Change-wide Review created or updated.
